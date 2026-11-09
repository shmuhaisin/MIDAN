-- Job-specific skills (owner's master brief, part 6). Additive only.
--
-- Before this, every job was offered the same six skills (the draft taxonomy in public.skills), and the 5,074 workbook
-- skills were reached only when the job's text contained a skill's Arabic name. Now:
--   1. a proficiency level (L0–L4, the workbooks' scale) on each workbook skill linked to a job;
--   2. suggestions that read the job's meaning (the AI service ranks the workbook catalog against the job's own text and,
--      when the model is available, chooses from that shortlist with a reason), recorded as a job analysis so the existing
--      accept/dismiss review applies; only real catalog ids can be proposed;
--   3. the employer's own skills for one job, kept on that job and never added to the shared catalog.
-- The employer's accepted list is what matching and assessment generation read.

alter table public.job_reference_skills
  add column required_level smallint check (required_level between 0 and 4);
comment on column public.job_reference_skills.required_level is
  'Expected proficiency on the workbooks'' L0–L4 scale, set by the employer; null when not set.';

create table public.job_custom_skills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  name_ar text check (char_length(name_ar) between 1 and 200),
  name_en text check (char_length(name_en) between 1 and 200),
  description text check (char_length(description) <= 1000),
  is_required boolean not null default false,
  required_level smallint check (required_level between 0 and 4),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (name_ar is not null or name_en is not null),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
create index on public.job_custom_skills (job_id);
create unique index job_custom_skills_unique_name on public.job_custom_skills
  (job_id, lower(coalesce(name_en, '')), coalesce(name_ar, ''));
alter table public.job_custom_skills enable row level security;
create policy "org members read" on public.job_custom_skills for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.job_custom_skills for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
create policy "public reads published" on public.job_custom_skills for select to anon, authenticated using (
  exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published')
);
grant select on public.job_custom_skills to anon, authenticated;
grant insert, update, delete on public.job_custom_skills to authenticated;
create trigger set_updated_at before update on public.job_custom_skills for each row execute function private.set_updated_at();

/**
 * Records suggestions made by reading the job's meaning, as a job analysis the employer accepts or dismisses like any
 * other. Each proposal is rebuilt from the catalog row it names (name, sector, source), so a proposal can only point at a
 * real workbook skill; what comes from the suggester is the basis, its reason, required or preferred, and a level.
 */
create function public.record_skill_suggestions(p_job uuid, p_method text, p_sector text, p_proposals jsonb)
returns public.job_analyses language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  v_proposals jsonb;
  a public.job_analyses;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_org_member(j.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Job not available' using errcode = '42501';
  end if;
  if p_method not in ('ai_suggestions_v1', 'semantic_similarity_v1') then
    raise exception 'Unknown suggestion method' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'reference_skill_id', s.id, 'name_ar', s.name_ar, 'sector_code', s.sector_code,
      'basis', case when p_method = 'ai_suggestions_v1' then 'ai' else 'similar' end,
      'evidence', left(p ->> 'reason_ar', 400), 'reason_en', left(p ->> 'reason_en', 400), 'reason_ar', left(p ->> 'reason_ar', 400),
      'required', coalesce((p ->> 'required')::boolean, false),
      'level', case when (p ->> 'level') ~ '^[0-4]$' then (p ->> 'level')::int end,
      'score', case when (p ->> 'score') ~ '^-?[0-9.]+$' then round((p ->> 'score')::numeric, 3) end,
      'is_priority', s.is_priority,
      'source', jsonb_build_object('file', s.source_file, 'sheet', s.source_sheet, 'row', s.source_row)
    ) order by x.ord), '[]')
  into v_proposals
  from jsonb_array_elements(coalesce(p_proposals, '[]')) with ordinality x(p, ord)
  join public.reference_skills s on s.id::text = x.p ->> 'reference_skill_id';
  insert into public.job_analyses (job_id, org_id, method, sector_code, proposals, stated, created_by)
  values (j.id, j.org_id, p_method, coalesce(nullif(p_sector, ''), j.sector), v_proposals, '{}', auth.uid())
  returning * into a;
  return a;
end $$;

/** Accepts chosen proposals with their levels: the employer's choice of level wins over the suggested one. */
create function public.accept_job_analysis(p_analysis uuid, p_skills uuid[], p_required uuid[], p_set_sector boolean, p_levels jsonb)
returns public.job_analyses language plpgsql security definer set search_path = '' as $$
declare a public.job_analyses;
begin
  select * into a from public.job_analyses where id = p_analysis for update;
  if a.id is null or not private.is_org_member(a.org_id, array['owner', 'admin', 'recruiter']::public.org_role[]) then
    raise exception 'Analysis not available' using errcode = '42501';
  end if;
  if a.status <> 'proposed' then raise exception 'This analysis was already decided' using errcode = '23514'; end if;
  insert into public.job_reference_skills (job_id, org_id, reference_skill_id, is_required, required_level)
  select a.job_id, a.org_id, (p ->> 'reference_skill_id')::uuid, (p ->> 'reference_skill_id')::uuid = any(coalesce(p_required, '{}')),
    case
      when coalesce(p_levels, '{}') ? (p ->> 'reference_skill_id') then
        case when (p_levels ->> (p ->> 'reference_skill_id')) ~ '^[0-4]$' then (p_levels ->> (p ->> 'reference_skill_id'))::smallint end
      when (p ->> 'level') ~ '^[0-4]$' then (p ->> 'level')::smallint
    end
  from jsonb_array_elements(a.proposals) p where (p ->> 'reference_skill_id')::uuid = any(coalesce(p_skills, '{}'))
  -- Accepting again keeps a level the employer already set on a skill that was linked before.
  on conflict (job_id, reference_skill_id) do update set is_required = excluded.is_required,
    required_level = coalesce(excluded.required_level, public.job_reference_skills.required_level);
  if p_set_sector and a.sector_code is not null then
    update public.jobs set sector = a.sector_code where id = a.job_id;
  end if;
  update public.job_analyses set status = 'accepted', decided_at = now() where id = a.id returning * into a;
  return a;
end $$;

revoke all on function public.record_skill_suggestions(uuid, text, text, jsonb),
  public.accept_job_analysis(uuid, uuid[], uuid[], boolean, jsonb) from public, anon;
grant execute on function public.record_skill_suggestions(uuid, text, text, jsonb),
  public.accept_job_analysis(uuid, uuid[], uuid[], boolean, jsonb) to authenticated;
