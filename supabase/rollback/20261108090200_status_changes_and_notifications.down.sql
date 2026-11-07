-- Rolls back 20261108090200_status_changes_and_notifications. Run as postgres, in one transaction.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Notifications already sent stay. Applications moved back from shortlisted keep their status.
drop trigger notify_status_change on public.application_status_history;
drop function private.notify_status_change();

create or replace function private.manual_status_change_allowed(p_from public.application_status, p_to public.application_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_to
    when 'under_review' then p_from in ('submitted', 'rejected')
    when 'shortlisted' then p_from in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated', 'rejected')
    when 'rejected' then p_from in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated', 'shortlisted')
    when 'hired' then p_from in ('shortlisted', 'evaluated')
    else false
  end
$$;

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
