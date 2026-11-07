-- Rolls back 20261108090000_employers_read_application_snapshots. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Restores the live-profile policies and the earlier snapshot. Snapshots taken in between keep their skill lists.

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

create policy "org reads applicants" on public.candidate_profiles for select to authenticated
  using (private.can_view_candidate(user_id));
create policy "org reads applicants" on public.candidate_skills for select to authenticated
  using (private.can_view_candidate(candidate_id));
create policy "org reads applicant skills" on public.candidate_reference_skills for select to authenticated
  using (private.can_view_candidate_path(candidate_id::text));
