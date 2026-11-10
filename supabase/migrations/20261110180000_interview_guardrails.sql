-- Enforce the interview shortlist rule and prevent duplicate active interview slots.
-- The API performs the same checks for clear user-facing errors; these database guards protect every write path.

create or replace function public.require_shortlisted_interview_candidate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  application_status public.application_status;
begin
  select a.status into application_status
  from public.applications a
  where a.id = new.application_id
    and a.org_id = new.org_id;

  if not found then
    raise exception 'Interview application not found for this organization'
      using errcode = '23503';
  end if;

  if application_status <> 'shortlisted' then
    raise exception 'Shortlist the candidate before scheduling an interview'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists interviews_require_shortlisted_candidate on public.interviews;
create trigger interviews_require_shortlisted_candidate
before insert or update of application_id, org_id on public.interviews
for each row execute function public.require_shortlisted_interview_candidate();

do $$
begin
  if exists (
    select 1
    from public.interviews
    where status <> 'cancelled'
    group by application_id, scheduled_at
    having count(*) > 1
  ) then
    raise exception 'Cannot add interview slot uniqueness: duplicate active application/time pairs already exist. Review these rows before retrying.';
  end if;
end $$;

create unique index if not exists interviews_one_active_slot_per_application
  on public.interviews (application_id, scheduled_at)
  where status <> 'cancelled';
