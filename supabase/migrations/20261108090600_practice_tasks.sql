-- P2: practical experience for a target role. MIDAN gives a candidate a practice task for one of the role's skills, from a
-- fixed template: either a simulated task or a portfolio project. Neither is employment, and the screens never call it
-- work experience. The candidate submits; MIDAN returns a checklist on the submission, which isn't an assessment and which
-- no employer has seen. Practice tasks are the candidate's own: no organization reads them.
--
-- The template content and the checklist are MIDAN's: only the Core API writes them (midan.practice = 'midan', set in its
-- own transaction), so a candidate can't present invented feedback as MIDAN's through the Data API.

create table public.practice_tasks (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.users (id) on delete cascade,
  reference_skill_id uuid not null references public.reference_skills (id),
  kind text not null check (kind in ('simulated_task', 'portfolio_project')),
  template_version text not null,
  title_ar text not null,
  title_en text not null,
  brief_ar text not null,
  brief_en text not null,
  instructions jsonb not null default '[]' check (jsonb_typeof(instructions) = 'array'),
  deliverables jsonb not null default '[]' check (jsonb_typeof(deliverables) = 'array'),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'submitted', 'completed')),
  submission text check (length(submission) <= 20000),
  submission_url text check (submission_url is null or submission_url ~ '^https://'),
  submitted_at timestamptz,
  completed_at timestamptz,
  feedback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, reference_skill_id, kind)
);
create index on public.practice_tasks (reference_skill_id);

create function private.guard_practice_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare midan boolean := coalesce(current_setting('midan.practice', true), '') = 'midan';
begin
  if tg_op = 'INSERT' then
    if not midan then raise exception 'Practice tasks come from MIDAN''s templates' using errcode = '42501'; end if;
    new.candidate_id := auth.uid();
  else
    if not midan and (new.feedback is distinct from old.feedback or new.title_ar is distinct from old.title_ar or new.title_en is distinct from old.title_en
      or new.brief_ar is distinct from old.brief_ar or new.brief_en is distinct from old.brief_en or new.instructions is distinct from old.instructions
      or new.deliverables is distinct from old.deliverables or new.template_version is distinct from old.template_version
      or new.submitted_at is distinct from old.submitted_at or new.status in ('submitted', 'completed')) then
      raise exception 'Only MIDAN changes a task''s content, its checklist or its submission state' using errcode = '42501';
    end if;
    new.id := old.id; new.candidate_id := old.candidate_id; new.reference_skill_id := old.reference_skill_id; new.kind := old.kind;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_practice_task before insert or update on public.practice_tasks for each row execute function private.guard_practice_task();
revoke all on function private.guard_practice_task() from public, anon, authenticated;

alter table public.practice_tasks enable row level security;
create policy "own" on public.practice_tasks for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
grant select, insert, update, delete on public.practice_tasks to authenticated;
