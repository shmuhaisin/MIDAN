-- The owner's decisions on three application rules (2026-11-07).
--
-- 1. Reopening a rejected application is for a hiring manager, and leaves its own audit record. MIDAN has no role by that
--    name, so it means the organization's owners and admins, who already hold every other final decision. Recruiters can
--    still reject, shortlist and hire as before.
-- 2. Hiring through an interview outcome needs an application that is already shortlisted. Nothing shortlists it on the
--    way: the hiring manager does that first, in the open. Manual hiring keeps its own rule.
-- 3. An application without a CV copy no longer exposes the candidate's current CV. The organization sees a CV only when
--    the candidate submitted it, or later chose to share it (public.share_cv_with_application).

create or replace function public.set_application_status(p_application uuid, p_status public.application_status)
returns public.applications language plpgsql security definer set search_path = '' as $$
declare
  a public.applications;
  v_from public.application_status;
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
  if a.status = 'rejected' and not private.is_org_member(a.org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only a hiring manager can reopen a rejected application' using errcode = '42501';
  end if;
  if p_status = 'hired' and not private.assessments_reviewed(p_application) then
    raise exception 'Hiring is not allowed until every assessment is reviewed' using errcode = '23514';
  end if;
  v_from := a.status;
  update public.applications set status = p_status where id = p_application returning * into a;
  if v_from = 'rejected' then
    insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
    values (a.org_id, auth.uid(), 'reopen', 'applications', a.id::text, jsonb_build_object('from', v_from, 'to', p_status));
  end if;
  return a;
end $$;

-- Same function as in 20261107100100_hired_is_final_for_outcomes.sql, apart from the shortlist check.
create or replace function private.guard_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  if a.status = 'hired' then
    raise exception 'A hired application cannot be changed' using errcode = '23514';
  end if;
  if new.outcome = 'hired' and a.status <> 'shortlisted' then
    raise exception 'Hiring through an outcome is not allowed until the application is shortlisted' using errcode = '23514';
  end if;
  if new.outcome = 'hired' and not private.assessments_reviewed(new.application_id) then
    raise exception 'Hiring is not allowed until every assessment is reviewed' using errcode = '23514';
  end if;
  new.candidate_id := a.candidate_id;
  new.issued_by := auth.uid();
  new.issued_at := now();
  return new;
end $$;

-- Same function as in 20261107090000_scope_candidate_document_access.sql, without the fallback to the current CV.
create or replace function private.can_view_candidate_document(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id and m.user_id = auth.uid()
    where a.status <> 'withdrawn'
      and a.candidate_id::text = (storage.foldername(p_name))[1]
      and a.cv_snapshot_path = p_name
  )
$$;

-- Same function as in 20261105231050_candidate_experience_fixes.sql, apart from what it does with the CV copy.
create or replace function private.guard_application() returns trigger
language plpgsql security definer set search_path = '' as $$
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
  -- Only public.share_cv_with_application attaches a copy later on. Nothing else can reach this table to set the flag.
  new.cv_snapshot_path := case
    when new.status = 'withdrawn' then null
    when old.cv_snapshot_path is null and current_setting('midan.sharing_cv', true) = 'on' then new.cv_snapshot_path
    else old.cv_snapshot_path
  end;
  return new;
end $$;

/**
 * The candidate's explicit choice to share a CV with an application made without one. It attaches a copy the API has just
 * made in the candidate's own folder, so later changes to their CV don't change what the organization reads.
 */
create function public.share_cv_with_application(p_application uuid, p_path text)
returns public.applications language plpgsql security definer set search_path = '' as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application and candidate_id = auth.uid() for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if a.status = 'withdrawn' then raise exception 'A withdrawn application cannot be changed' using errcode = '23514'; end if;
  if a.cv_snapshot_path is not null then raise exception 'A CV is already attached and cannot be changed' using errcode = '23514'; end if;
  if p_path is null or p_path !~ ('^' || auth.uid()::text || '/applications/' || a.job_id::text || '/[^/]+$') then
    raise exception 'This file does not belong to the application' using errcode = '23514';
  end if;
  perform set_config('midan.sharing_cv', 'on', true);
  update public.applications set cv_snapshot_path = p_path where id = p_application returning * into a;
  perform set_config('midan.sharing_cv', 'off', true);
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (a.org_id, auth.uid(), 'share_cv', 'applications', a.id::text, '{}');
  return a;
end $$;
revoke all on function public.share_cv_with_application(uuid, text) from public, anon;
grant execute on function public.share_cv_with_application(uuid, text) to authenticated;
