-- P1: shortlisting can be undone without rejecting, and the candidate hears about deliberate staff decisions.
--
-- 1. shortlisted -> under_review is now a manual move (an organization changing its mind isn't a rejection). It goes through
--    public.set_application_status like every other move, so it is recorded in application_status_history.
-- 2. In-app notifications, written by the database so no screen can forget them:
--    - application_shortlisted and application_rejected when a staff member makes that move. Not when a hiring outcome
--      makes it: the outcome already sends hiring_decision, with the organization's own words. Undoing a shortlist sends
--      nothing: the candidate sees the status, and a notice that a shortlist was withdrawn would say more than the
--      organization chose to.
--    - interview_cancelled, instead of the general interview_changed, when an interview is cancelled.
--    Each status change has its own key (its history row), so a repeated move is a new notice and a retried one isn't.
-- Notifications are in-app only. No email is sent: none is configured.

-- Same function as in 20261107090100_application_status_transitions.sql, apart from shortlisted -> under_review.
create or replace function private.manual_status_change_allowed(p_from public.application_status, p_to public.application_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_to
    when 'under_review' then p_from in ('submitted', 'rejected', 'shortlisted')
    when 'shortlisted' then p_from in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated', 'rejected')
    when 'rejected' then p_from in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated', 'shortlisted')
    when 'hired' then p_from in ('shortlisted', 'evaluated')
    else false
  end
$$;

create function private.notify_status_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if new.from_status is null or new.to_status not in ('shortlisted', 'rejected') then return null; end if;
  -- A hiring outcome issued in this same transaction made the move, and already told the candidate.
  if exists (select 1 from public.hiring_outcomes o where o.application_id = new.application_id and o.issued_at = now()) then return null; end if;
  select candidate_id, job_id into a from public.applications where id = new.application_id;
  perform private.notify(a.candidate_id, 'application_' || new.to_status::text, a.job_id, '/applications/' || new.application_id, 'status:' || new.id);
  return null;
end $$;
create trigger notify_status_change after insert on public.application_status_history
  for each row execute function private.notify_status_change();
revoke all on function private.notify_status_change() from public, anon, authenticated;

-- Same function as in 20261105231050_candidate_experience_fixes.sql, apart from cancellation.
create or replace function private.notify_interview() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select job_id into v_job from public.applications where id = new.application_id;
  if tg_op = 'INSERT' then
    perform private.notify(new.candidate_id, 'interview_invited', v_job, '/interviews/' || new.id, 'interview:' || new.id);
  elsif new.scheduled_at is distinct from old.scheduled_at or new.status is distinct from old.status then
    if auth.uid() is distinct from new.candidate_id and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      perform private.notify(new.candidate_id, 'interview_cancelled', v_job, '/interviews/' || new.id, 'interview:' || new.id || ':cancelled');
    elsif auth.uid() is distinct from new.candidate_id then
      perform private.notify(new.candidate_id, 'interview_changed', v_job, '/interviews/' || new.id, 'interview:' || new.id || ':' || extract(epoch from new.updated_at));
    elsif new.created_by is not null then
      perform private.notify(new.created_by, 'interview_response', v_job, '/organization/' || new.org_id || '/applicants/' || new.application_id, 'response:' || new.id || ':' || extract(epoch from new.updated_at));
    end if;
  end if;
  return null;
end $$;
