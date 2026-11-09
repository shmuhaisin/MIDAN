-- Employer brief, section 12: a candidate must be shortlisted before an interview can be created. Before this, only a
-- withdrawn application (or another organization's) was refused (private.guard_interview). Enforced in the database, so
-- every path (API, Data API, scripts) follows it. Existing interviews are untouched; rescheduling one is an update, not
-- a creation, and stays allowed. Hiring keeps its own rules (20261107110000_application_decision_rules).
create function private.guard_interview_shortlist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.applications a where a.id = new.application_id and a.status = 'shortlisted') then
    raise exception 'An interview is not allowed until the candidate is shortlisted' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_interview_shortlist() from public, anon, authenticated;

-- Runs after guard_interview (name order), which already refused withdrawn and other organizations' applications.
create trigger guard_interview_shortlist before insert on public.interviews
  for each row execute function private.guard_interview_shortlist();
