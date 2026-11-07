-- Rolls back 20261107110000_application_decision_rules. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

drop function if exists public.share_cv_with_application(uuid, text);
create or replace function private.can_view_candidate_document(p_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id and m.user_id = auth.uid()
    where a.status <> 'withdrawn'
      and a.candidate_id::text = (storage.foldername(p_name))[1]
      and (a.cv_snapshot_path = p_name
        or (a.cv_snapshot_path is null
          and exists (select 1 from public.candidate_profiles p where p.user_id = a.candidate_id and p.cv_path = p_name)))
  )
$$;
create or replace function private.guard_application() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare j record;
begin
  if tg_op = 'INSERT' then
    select org_id, status into j from public.jobs where id = new.job_id;
    if not found or j.status <> 'published' then
      raise exception 'This job is not open for applications' using errcode = '23514';
    end if;
    new.org_id := j.org_id;
    new.status := 'submitted';
    if new.cv_snapshot_path is not null and new.cv_snapshot_path not like new.candidate_id::text || '/applications/%' then
      raise exception 'This file does not belong to the application' using errcode = '23514';
    end if;
    select to_jsonb(p) - 'user_id' - 'cv_path' - 'onboarding_step' - 'onboarding_completed_at' - 'notification_prefs' - 'time_zone' - 'created_at' - 'updated_at'
      || jsonb_build_object('email', (select u.email from public.users u where u.id = new.candidate_id), 'captured_at', now())
      into new.profile_snapshot from public.candidate_profiles p where p.user_id = new.candidate_id;
    return new;
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if new.status = 'withdrawn' and old.status <> 'withdrawn' and auth.uid() is distinct from old.candidate_id then
    raise exception 'Only the candidate can withdraw an application' using errcode = '42501';
  end if;
  new.profile_snapshot := case when new.status = 'withdrawn' then null else old.profile_snapshot end;
  new.cv_snapshot_path := case when new.status = 'withdrawn' then null else old.cv_snapshot_path end;
  return new;
end $$;
create or replace function private.guard_outcome() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare a record;
begin
  select candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  if a.status = 'hired' then
    raise exception 'A hired application cannot be changed' using errcode = '23514';
  end if;
  if new.outcome = 'hired' and not private.assessments_reviewed(new.application_id) then
    raise exception 'Hiring is not allowed until every assessment is reviewed' using errcode = '23514';
  end if;
  new.candidate_id := a.candidate_id;
  new.issued_by := auth.uid();
  new.issued_at := now();
  return new;
end $$;
create or replace function public.set_application_status(p_application uuid, p_status public.application_status) RETURNS public.applications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application for update;
  -- Another organization's application, or the candidate's own, looks the same as a missing one.
  if not found or not private.is_org_member(a.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status = p_status then return a; end if;
  if a.status = 'withdrawn' then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if not private.manual_status_change_allowed(a.status, p_status) then
    raise exception 'Status cannot be changed from % to %', a.status, p_status using errcode = '23514';
  end if;
  if p_status = 'hired' and not private.assessments_reviewed(p_application) then
    raise exception 'Hiring is not allowed until every assessment is reviewed' using errcode = '23514';
  end if;
  update public.applications set status = p_status where id = p_application returning * into a;
  return a;
end $$;
