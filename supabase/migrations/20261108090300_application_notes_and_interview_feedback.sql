-- P1: the organization's own record of a candidate, kept apart from MIDAN's assessment.
--
-- application_notes: staff notes on an application. An append-only history: each note keeps its author and time, and
-- nobody edits or deletes a note, their own included. Organization staff only; never the candidate.
--
-- interview_feedback: one interviewer's structured view of one interview. Only the interview's participants write it, each
-- their own. A draft is visible to its author alone; once submitted it can't change, and the organization's staff read it.
-- "recommendation" is that interviewer's opinion, not a decision: the hiring decision is still a hiring outcome a person
-- issues. Interview feedback never feeds MIDAN's assessment scores, and the candidate never sees it.

create table public.application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid not null references public.users (id),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (application_id, org_id) references public.applications (id, org_id) on delete cascade
);
create index on public.application_notes (application_id, org_id);
create index on public.application_notes (org_id);
create index on public.application_notes (author_id);

create function private.guard_application_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.applications where id = new.application_id and status <> 'withdrawn';
  if v_org is null then raise exception 'Application is not available' using errcode = '23514'; end if;
  new.org_id := v_org;
  new.author_id := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger guard_application_note before insert on public.application_notes for each row execute function private.guard_application_note();
create trigger write_audit after insert on public.application_notes for each row execute function private.write_audit();

alter table public.application_notes enable row level security;
create policy "org members read" on public.application_notes for select to authenticated using (private.is_org_member(org_id));
create policy "org members write" on public.application_notes for insert to authenticated
  with check (private.is_org_member(org_id) and author_id = auth.uid());
grant select, insert on public.application_notes to authenticated;

create table public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null,
  author_id uuid not null references public.users (id),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  recommendation text check (recommendation in ('strong_yes', 'yes', 'no', 'strong_no')),
  -- [{ "label": text, "rating": 1-4, "evidence": text }]: the job's own competencies, rated on what the interview showed.
  competencies jsonb not null default '[]',
  notes text check (length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (interview_id, author_id),
  foreign key (application_id, org_id) references public.applications (id, org_id) on delete cascade
);
create index on public.interview_feedback (org_id);
create index on public.interview_feedback (application_id, org_id);
create index on public.interview_feedback (author_id);

create function private.valid_competencies(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20 and not exists (
    select 1 from jsonb_array_elements(p) c
    where jsonb_typeof(c) <> 'object'
      or length(btrim(coalesce(c ->> 'label', ''))) not between 1 and 300
      or (c ? 'rating' and jsonb_typeof(c -> 'rating') <> 'null' and (jsonb_typeof(c -> 'rating') <> 'number' or (c ->> 'rating')::numeric not in (1, 2, 3, 4)))
      or length(coalesce(c ->> 'evidence', '')) > 2000
  )
$$;

create function private.guard_interview_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  if not private.valid_competencies(new.competencies) then
    raise exception 'Each competency needs a label, a rating from 1 to 4 and at most 2,000 characters of evidence' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    select org_id, application_id, status into i from public.interviews where id = new.interview_id;
    if not found then raise exception 'Interview not available' using errcode = '23514'; end if;
    -- Who first, then what: someone who didn't take part learns nothing about the interview's state.
    if not exists (
      select 1 from public.interview_participants p join public.organization_members m on m.org_id = p.org_id and m.user_id = p.user_id
      where p.interview_id = new.interview_id and p.user_id = auth.uid()
    ) then
      raise exception 'Only the interview''s participants can give feedback' using errcode = '42501';
    end if;
    if i.status = 'cancelled' then raise exception 'A cancelled interview cannot be changed' using errcode = '23514'; end if;
    new.org_id := i.org_id;
    new.application_id := i.application_id;
    new.author_id := auth.uid();
    new.created_at := now();
  else
    if old.status = 'submitted' then raise exception 'Submitted feedback can''t be changed' using errcode = '23514'; end if;
    new.id := old.id; new.interview_id := old.interview_id; new.org_id := old.org_id;
    new.application_id := old.application_id; new.author_id := old.author_id; new.created_at := old.created_at;
  end if;
  if new.status = 'submitted' then
    if new.recommendation is null or jsonb_array_length(new.competencies) = 0
      or exists (select 1 from jsonb_array_elements(new.competencies) c where jsonb_typeof(c -> 'rating') is distinct from 'number') then
      raise exception 'Rate every competency and give a recommendation before submitting' using errcode = '23514';
    end if;
    new.submitted_at := now();
  else
    new.submitted_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_interview_feedback before insert or update on public.interview_feedback
  for each row execute function private.guard_interview_feedback();
create trigger write_audit after insert or update on public.interview_feedback for each row execute function private.write_audit();

alter table public.interview_feedback enable row level security;
create policy "author reads own" on public.interview_feedback for select to authenticated using (author_id = auth.uid());
create policy "org reads submitted" on public.interview_feedback for select to authenticated
  using (status = 'submitted' and private.is_org_member(org_id));
create policy "author writes own" on public.interview_feedback for insert to authenticated
  with check (author_id = auth.uid() and private.is_org_member(org_id));
create policy "author edits own draft" on public.interview_feedback for update to authenticated
  using (author_id = auth.uid() and status = 'draft') with check (author_id = auth.uid());
grant select, insert on public.interview_feedback to authenticated;
grant update (status, recommendation, competencies, notes) on public.interview_feedback to authenticated;

revoke all on function private.guard_application_note(), private.guard_interview_feedback(), private.valid_competencies(jsonb) from public, anon, authenticated;
