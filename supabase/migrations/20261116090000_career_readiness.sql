-- Career readiness (feature/midan-product-experience). Local only until the owner approves it for Cloud.
--
-- A candidate's own readiness check for a job title they type in their own words. MIDAN's live model writes the target
-- role's requirements and a short practical readiness assessment; MIDAN's matching model (e5, the same rule as the ATS)
-- compares the candidate's own profile with those requirements; the candidate answers; the model evaluates the answers
-- against their rubric and writes a roadmap whose courses and certifications come only from the verified catalog
-- (learning_resources). Everything here is the candidate's own: nobody else reads it, and no employer sees it.

create table public.career_readiness (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.users (id) on delete cascade,
  target_title text not null check (length(btrim(target_title)) between 2 and 120),
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  status text not null default 'assessment' check (status in ('assessment', 'evaluated')),
  -- {requirements: [...], questions: [...], summary_ar, summary_en}: the model's view of the target role, both languages.
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and plan ? 'requirements' and plan ? 'questions'),
  -- The matcher's comparison of the candidate's profile with plan.requirements (statuses, evidence, provenance).
  comparison jsonb not null check (jsonb_typeof(comparison) = 'object'),
  answers jsonb,
  -- {questions: [...scores and feedback], readiness: {...}, roadmap: [...], recommendations: [...]}
  evaluation jsonb,
  provenance jsonb not null check (provenance ? 'mode'),
  created_at timestamptz not null default now(),
  evaluated_at timestamptz
);
create index on public.career_readiness (candidate_id, created_at desc);

create function private.guard_career_readiness() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.candidate_id := auth.uid();
    new.status := 'assessment';
    new.answers := null;
    new.evaluation := null;
    new.evaluated_at := null;
    new.created_at := now();
  else
    -- Once evaluated, a check is kept as it was; a new check is a new row.
    if old.status = 'evaluated' then raise exception 'An evaluated readiness check is kept as it was' using errcode = '42501'; end if;
    if new.candidate_id <> old.candidate_id or new.target_title <> old.target_title or new.plan <> old.plan or new.comparison <> old.comparison then
      raise exception 'Only the answers and the evaluation of a readiness check can change' using errcode = '42501';
    end if;
    if new.status = 'evaluated' then new.evaluated_at := now(); end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_career_readiness() from public, anon, authenticated;
create trigger guard_career_readiness before insert or update on public.career_readiness
  for each row execute function private.guard_career_readiness();

alter table public.career_readiness enable row level security;
create policy "own read" on public.career_readiness for select to authenticated using (candidate_id = auth.uid());
create policy "own write" on public.career_readiness for insert to authenticated with check (candidate_id = auth.uid());
create policy "own answer" on public.career_readiness for update to authenticated
  using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
grant select, insert on public.career_readiness to authenticated;
grant update (answers, evaluation, status) on public.career_readiness to authenticated;

-- What a recommendation shows, from the official page, checked when it's added (verified_on). Optional: a field that
-- wasn't confirmed stays empty and the screen sends the reader to the official page instead.
alter table public.learning_resources
  add column skills_en text[] not null default '{}',
  add column skills_ar text[] not null default '{}',
  add column level text check (level is null or level in ('beginner', 'intermediate', 'advanced')),
  add column duration text check (duration is null or length(duration) <= 120),
  add column cost text check (cost is null or length(cost) <= 120),
  add column prerequisites text check (prerequisites is null or length(prerequisites) <= 500),
  add column target_roles text[] not null default '{}',
  add column verification jsonb;
