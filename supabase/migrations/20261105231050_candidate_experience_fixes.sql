-- A withdrawal ends the organization's access, so what was submitted with the application goes too.
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
  new.cv_snapshot_path := case when new.status = 'withdrawn' then null else old.cv_snapshot_path end;
  return new;
end $$;

create or replace function private.notify_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select job_id into v_job from public.applications where id = new.application_id;
  if tg_op = 'INSERT' then
    perform private.notify(new.candidate_id, 'assessment_assigned', v_job, '/applications/' || new.application_id, 'assigned:' || new.id);
  elsif new.status = 'submitted' and old.status <> 'submitted' then
    perform private.notify(new.candidate_id, 'submission_received', v_job, '/applications/' || new.application_id, 'submitted:' || new.id || ':' || coalesce(new.receipt_code, ''));
  end if;
  return null;
end $$;

-- The person who scheduled the interview hears the candidate's answer.
create or replace function private.notify_interview() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select job_id into v_job from public.applications where id = new.application_id;
  if tg_op = 'INSERT' then
    perform private.notify(new.candidate_id, 'interview_invited', v_job, '/interviews/' || new.id, 'interview:' || new.id);
  elsif new.scheduled_at is distinct from old.scheduled_at or new.status is distinct from old.status then
    if auth.uid() is distinct from new.candidate_id then
      perform private.notify(new.candidate_id, 'interview_changed', v_job, '/interviews/' || new.id, 'interview:' || new.id || ':' || extract(epoch from new.updated_at));
    elsif new.created_by is not null then
      perform private.notify(new.created_by, 'interview_response', v_job, '/organization/' || new.org_id || '/applicants/' || new.application_id, 'response:' || new.id || ':' || extract(epoch from new.updated_at));
    end if;
  end if;
  return null;
end $$;
