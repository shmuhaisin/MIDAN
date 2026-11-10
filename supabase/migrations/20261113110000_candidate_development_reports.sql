-- Candidate development reports (feature/midan-company-journey). Local only until the owner approves it for Cloud.
--
-- A report for one application, written from that candidate's own evidence only: the requirements their submitted
-- profile shows or doesn't, their person-reviewed assessment results by criterion, and the interview competencies as
-- rated (an average per competency, never an interviewer's name, notes or evidence text). It never holds internal notes,
-- other candidates' results, rankings or contact details. The organization's staff draft it (MIDAN's model may write
-- the narrative from cited facts), an owner, admin or recruiter releases it, and the candidate reads it after release,
-- told through the in-app notifications, MIDAN's approved channel. A released report is never changed.

create table public.candidate_development_reports (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'released')),
  -- {strengths: [..], development: [..], next_steps: [..], evidence: {requirements, assessment, interview}}, both languages.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  provenance jsonb not null check (provenance ? 'mode'),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  released_by uuid references public.users (id),
  released_at timestamptz
);
create index on public.candidate_development_reports (application_id, created_at desc);

create function private.guard_development_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if tg_op = 'INSERT' then
    select org_id, candidate_id, job_id into a from public.applications where id = new.application_id;
    if not found then raise exception 'Application not found' using errcode = '23503'; end if;
    if not private.is_org_member(a.org_id) then
      raise exception 'Only the organization''s staff write its development reports' using errcode = '42501';
    end if;
    new.org_id := a.org_id;
    new.candidate_id := a.candidate_id;
    new.created_by := auth.uid();
    new.status := 'draft';
    new.released_by := null;
    new.released_at := null;
    return new;
  end if;
  -- Updates: only a draft's release, by an owner, admin or recruiter; its content is then fixed for good.
  if old.status = 'released' then raise exception 'A released report is not changed' using errcode = '23514'; end if;
  if new.status <> 'released' or new.content is distinct from old.content or new.application_id <> old.application_id
     or new.org_id <> old.org_id or new.candidate_id <> old.candidate_id or new.provenance is distinct from old.provenance then
    raise exception 'A draft is only released here; write a new draft to change it' using errcode = '23514';
  end if;
  if not private.is_org_member(old.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Only an owner, admin or recruiter releases a report' using errcode = '42501';
  end if;
  new.released_by := auth.uid();
  new.released_at := now();
  select job_id into a from public.applications where id = old.application_id;
  perform private.notify(old.candidate_id, 'development_report', a.job_id, '/applications/' || old.application_id, 'development_report:' || old.id);
  return new;
end $$;
revoke all on function private.guard_development_report() from public, anon, authenticated;
create trigger guard_development_report before insert or update on public.candidate_development_reports
  for each row execute function private.guard_development_report();
create trigger write_audit after insert or update on public.candidate_development_reports for each row execute function private.write_audit();

alter table public.candidate_development_reports enable row level security;
create policy "org staff read" on public.candidate_development_reports for select to authenticated using (private.is_org_member(org_id));
create policy "candidate reads released" on public.candidate_development_reports for select to authenticated
  using (candidate_id = auth.uid() and status = 'released');
create policy "org staff write" on public.candidate_development_reports for insert to authenticated with check (private.is_org_member(org_id));
create policy "org staff release" on public.candidate_development_reports for update to authenticated using (private.is_org_member(org_id));
grant select, insert on public.candidate_development_reports to authenticated;
grant update (status) on public.candidate_development_reports to authenticated;
