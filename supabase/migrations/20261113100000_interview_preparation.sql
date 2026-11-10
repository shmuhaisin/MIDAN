-- Interview preparation (feature/midan-company-journey). Local only until the owner approves it for Cloud.
--
-- For one interview, MIDAN's model proposes the questions to ask this candidate and the evaluation form the interviewers
-- fill in afterwards, grounded in facts the Core API read with the staff member's permissions (the job's approved
-- requirements, the company's context, the CV match, the reviewed assessment). Each generation is a new row, so the
-- history stays; the newest of each kind is the current one. Rows are never edited or deleted.
--
-- Staff of the interview's organization read them; the candidate never does. Submitted interview feedback stays in
-- interview_feedback, with its own rules (participants only, every competency rated before submitting).

create table public.interview_preparations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('questions', 'evaluation_form')),
  -- questions: [{question_ar, question_en, purpose, requirement_key, fact_ids, listen_for_ar, listen_for_en}]
  -- evaluation_form: [{label_ar, label_en, requirement_key, fact_ids, criteria_ar, criteria_en, levels_ar, levels_en}]
  content jsonb not null check (jsonb_typeof(content) = 'array' and jsonb_array_length(content) between 1 and 20),
  -- The facts the model was given, as sent (already redacted), so every item can be traced to what it cites.
  facts jsonb not null check (jsonb_typeof(facts) = 'array'),
  provenance jsonb not null check (provenance ? 'mode' and provenance ->> 'mode' = 'live' and provenance ? 'model_version'),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);
create index on public.interview_preparations (interview_id, kind, created_at desc);

create function private.guard_interview_preparation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  select application_id, org_id into i from public.interviews where id = new.interview_id;
  if not found then raise exception 'Interview not found' using errcode = '23503'; end if;
  new.application_id := i.application_id;
  new.org_id := i.org_id;
  new.created_by := auth.uid();
  if not private.is_org_member(i.org_id) then
    raise exception 'Only the organization''s staff prepare its interviews' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_interview_preparation() from public, anon, authenticated;
create trigger guard_interview_preparation before insert on public.interview_preparations
  for each row execute function private.guard_interview_preparation();
create trigger write_audit after insert on public.interview_preparations for each row execute function private.write_audit();

alter table public.interview_preparations enable row level security;
create policy "org staff read" on public.interview_preparations for select to authenticated using (private.is_org_member(org_id));
create policy "org staff add" on public.interview_preparations for insert to authenticated with check (private.is_org_member(org_id));
grant select, insert on public.interview_preparations to authenticated;
