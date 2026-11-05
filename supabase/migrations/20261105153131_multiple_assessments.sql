-- A job can have several assessments, so an application's status now comes from all of its attempts.
-- A decision a person made (shortlisted, rejected, hired) and a withdrawal are never overwritten.

create function private.sync_application_status(p_application uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_next public.application_status;
begin
  select case
    when count(*) = 0 then null
    when bool_or(t.status = 'in_progress') then 'assessment_in_progress'
    when bool_or(t.status = 'invited') then 'assessment_invited'
    when bool_and(r.status is not distinct from 'reviewed') then 'evaluated'
    else 'assessment_submitted'
  end::public.application_status into v_next
  from public.assessment_attempts t
  left join public.evaluation_results r on r.attempt_id = t.id
  where t.application_id = p_application and t.status <> 'expired';

  if v_next is not null then
    update public.applications set status = v_next
    where id = p_application and status is distinct from v_next
      and status in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated');
  end if;
end $$;

revoke all on function private.sync_application_status(uuid) from public, anon, authenticated;

create or replace function private.mark_application_invited() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_application_status(new.application_id);
  return null;
end $$;

create or replace function private.mark_application_evaluated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'reviewed' and old.status <> 'reviewed' then
    perform private.sync_application_status((select t.application_id from public.assessment_attempts t where t.id = new.attempt_id));
  end if;
  return null;
end $$;

create or replace function public.start_attempt(p_attempt uuid) returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  update public.assessment_attempts set status = 'in_progress', started_at = now()
  where id = p_attempt and candidate_id = auth.uid() and status = 'invited' returning * into t;
  if not found then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  if exists (select 1 from public.applications a where a.id = t.application_id and a.status = 'withdrawn') then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  perform private.sync_application_status(t.application_id);
  return t;
end $$;

create or replace function public.submit_attempt(p_attempt uuid) returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  update public.assessment_attempts set status = 'submitted', submitted_at = now()
  where id = p_attempt and candidate_id = auth.uid() and status = 'in_progress' returning * into t;
  if not found then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  if exists (select 1 from public.applications a where a.id = t.application_id and a.status = 'withdrawn') then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  perform private.sync_application_status(t.application_id);
  return t;
end $$;

-- Same rules as before, plus: a candidate takes each assessment once, whichever version is current.
create or replace function private.guard_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select job_id, org_id, candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.assessment_versions v
    join public.assessments s on s.id = v.assessment_id
    where v.id = new.version_id and v.status = 'published' and s.job_id = a.job_id
  ) then
    raise exception 'Candidates can only be invited to a published version for this job' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.assessment_attempts t
    join public.assessment_versions taken on taken.id = t.version_id
    join public.assessment_versions wanted on wanted.id = new.version_id
    where t.application_id = new.application_id and taken.assessment_id = wanted.assessment_id
  ) then
    raise exception 'A candidate takes each assessment once' using errcode = '23514';
  end if;
  new.org_id := a.org_id;
  new.candidate_id := a.candidate_id;
  new.status := 'invited';
  new.invited_by := auth.uid();
  return new;
end $$;
