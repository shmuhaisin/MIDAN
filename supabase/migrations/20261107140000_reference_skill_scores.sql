-- Phase 4: how well the work showed each sector workbook skill its tasks measure. A percentage, never a level: the workbooks define
-- no proficiency levels, so Midan doesn't make one up. Written when a person reviews the evaluation, like skill_scores, and seen
-- by the candidate only once the result is released.
create table public.reference_skill_scores (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  reference_skill_id uuid not null references public.reference_skills (id),
  score_pct numeric(5, 2) not null check (score_pct between 0 and 100),
  source public.score_source not null,
  created_at timestamptz not null default now(),
  unique (result_id, reference_skill_id),
  foreign key (result_id, org_id) references public.evaluation_results (id, org_id) on delete cascade
);
create index on public.reference_skill_scores (org_id);
create index on public.reference_skill_scores (reference_skill_id);
alter table public.reference_skill_scores enable row level security;
create policy "org members read" on public.reference_skill_scores for select to authenticated using (private.is_org_member(org_id));
create policy "org evaluators write" on public.reference_skill_scores for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'reviewer']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'reviewer']::public.org_role[]));
create policy "candidate reads released" on public.reference_skill_scores for select to authenticated using (private.result_released_to_me(result_id));
grant select, insert on public.reference_skill_scores to authenticated;
