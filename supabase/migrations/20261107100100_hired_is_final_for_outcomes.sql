-- "Hired is final" held for a manual status change but not for a hiring outcome: issuing "not_selected" on a hired
-- application moved it to rejected. Outcomes now stop once the candidate is hired.
--
-- Same function as in 20261107090100_application_status_transitions.sql, apart from that check. Whether a rejected
-- application can be reopened, and whether an outcome's hire needs a shortlist, wait for the owner and are unchanged.
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
  if new.outcome = 'hired' and not private.assessments_reviewed(new.application_id) then
    raise exception 'Hiring is not allowed until every assessment is reviewed' using errcode = '23514';
  end if;
  new.candidate_id := a.candidate_id;
  new.issued_by := auth.uid();
  new.issued_at := now();
  return new;
end $$;
