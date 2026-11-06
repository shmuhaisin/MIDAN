-- Staff change an application's status only through public.set_application_status, which allows the moves below.
-- Before this, owners, admins and recruiters could write any status straight to the table: "hired" with no review of
-- the candidate's assessment, or "evaluated" with no evaluation.
--
-- Set by the system, never by hand, and unchanged here: the assessment stages (private.sync_application_status, from
-- attempts and evaluations, which is the only way to reach "evaluated") and a withdrawal (public.withdraw_application,
-- candidate only). They run as security definer functions, so revoking the direct update leaves them working.
--
-- Hiring, whether by hand or through a hiring outcome, needs every assessment the candidate was given (other than
-- expired ones) to have a human-reviewed evaluation. A job without an assessment has nothing to wait for.
--
-- The moves are mirrored in apps/web/src/lib/application-status.ts, which offers only these.

create function private.manual_status_change_allowed(p_from public.application_status, p_to public.application_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_to
    when 'under_review' then p_from in ('submitted', 'rejected')
    when 'shortlisted' then p_from in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated', 'rejected')
    when 'rejected' then p_from in ('submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated', 'shortlisted')
    when 'hired' then p_from in ('shortlisted', 'evaluated')
    else false
  end
$$;

create function private.assessments_reviewed(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.assessment_attempts t
    left join public.evaluation_results r on r.attempt_id = t.id
    where t.application_id = p_application and t.status <> 'expired' and r.status is distinct from 'reviewed'
  )
$$;

create function public.set_application_status(p_application uuid, p_status public.application_status)
returns public.applications language plpgsql security definer set search_path = '' as $$
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

revoke all on function private.manual_status_change_allowed(public.application_status, public.application_status),
  private.assessments_reviewed(uuid) from public, anon, authenticated;
revoke all on function public.set_application_status(uuid, public.application_status) from public, anon;
grant execute on function public.set_application_status(uuid, public.application_status) to authenticated;

drop policy "org updates status" on public.applications;
revoke update on public.applications from authenticated;

-- The same condition for a hiring outcome, which moves the application to "hired" (private.apply_outcome).
-- Same function as in 20261105231005_candidate_experience.sql, apart from that check.
create or replace function private.guard_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  if new.outcome = 'hired' and not private.assessments_reviewed(new.application_id) then
    raise exception 'Hiring is not allowed until every assessment is reviewed' using errcode = '23514';
  end if;
  new.candidate_id := a.candidate_id;
  new.issued_by := auth.uid();
  new.issued_at := now();
  return new;
end $$;
