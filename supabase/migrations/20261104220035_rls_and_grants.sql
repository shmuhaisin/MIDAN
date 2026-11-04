-- Default deny: remove Supabase's blanket grants, enable RLS everywhere, then allow explicitly.

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_org_member(uuid, public.org_role[]),
  private.can_view_candidate(uuid),
  private.candidate_has_version(uuid),
  private.candidate_has_assessment(uuid),
  private.attempt_submitted(uuid),
  private.result_released_to_me(uuid)
to anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Any member of an organization can read its tenant-owned rows.
  foreach t in array array[
    'organization_members', 'jobs', 'job_skills', 'applications', 'application_status_history',
    'assessments', 'assessment_versions', 'assessment_tasks', 'rubric_criteria', 'task_skill_mappings',
    'assessment_attempts', 'evaluation_results', 'criterion_scores', 'skill_scores', 'evaluation_reviews'
  ] loop
    execute format(
      'create policy "org members read" on public.%I for select to authenticated using (private.is_org_member(org_id))', t);
  end loop;

  -- Owners, admins and recruiters build jobs and assessments.
  foreach t in array array[
    'jobs', 'job_skills', 'assessments', 'assessment_versions', 'assessment_tasks', 'rubric_criteria', 'task_skill_mappings'
  ] loop
    execute format(
      $f$create policy "org builders write" on public.%I for all to authenticated
         using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
         with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))$f$, t);
  end loop;

  -- Owners, admins and reviewers record evaluations.
  foreach t in array array['evaluation_results', 'criterion_scores', 'skill_scores'] loop
    execute format(
      $f$create policy "org evaluators write" on public.%I for all to authenticated
         using (private.is_org_member(org_id, array['owner', 'admin', 'reviewer']::public.org_role[]))
         with check (private.is_org_member(org_id, array['owner', 'admin', 'reviewer']::public.org_role[]))$f$, t);
  end loop;
end $$;

-- Users and candidates.
create policy "self read" on public.users for select to authenticated using (id = (select auth.uid()));
create policy "org reads applicants" on public.users for select to authenticated using (private.can_view_candidate(id));
create policy "self update" on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "self all" on public.candidate_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "org reads applicants" on public.candidate_profiles for select to authenticated
  using (private.can_view_candidate(user_id));

create policy "self all" on public.candidate_skills for all to authenticated
  using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
create policy "org reads applicants" on public.candidate_skills for select to authenticated
  using (private.can_view_candidate(candidate_id));

-- Organizations. Public only once they have a published job.
create policy "public reads hiring orgs" on public.organizations for select to anon, authenticated
  using (exists (select 1 from public.jobs j where j.org_id = id and j.status = 'published'));
create policy "members read" on public.organizations for select to authenticated using (private.is_org_member(id));
create policy "admins update" on public.organizations for update to authenticated
  using (private.is_org_member(id, array['owner', 'admin']::public.org_role[]))
  with check (private.is_org_member(id, array['owner', 'admin']::public.org_role[]));

-- Only an owner can create or change an owner.
create policy "admins insert" on public.organization_members for insert to authenticated with check (
  private.is_org_member(org_id, array['owner']::public.org_role[])
  or (role <> 'owner' and private.is_org_member(org_id, array['admin']::public.org_role[]))
);
create policy "admins update" on public.organization_members for update to authenticated using (
  private.is_org_member(org_id, array['owner']::public.org_role[])
  or (role <> 'owner' and private.is_org_member(org_id, array['admin']::public.org_role[]))
) with check (
  private.is_org_member(org_id, array['owner']::public.org_role[])
  or (role <> 'owner' and private.is_org_member(org_id, array['admin']::public.org_role[]))
);
create policy "admins delete" on public.organization_members for delete to authenticated using (
  private.is_org_member(org_id, array['owner']::public.org_role[])
  or (role <> 'owner' and private.is_org_member(org_id, array['admin']::public.org_role[]))
);

create policy "admins manage" on public.organization_invitations for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));

create policy "public reads" on public.organization_branding for select to anon, authenticated using (true);
create policy "admins update" on public.organization_branding for update to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));

-- Taxonomy: readable by all, written only by migrations and seeds.
create policy "public reads" on public.skill_categories for select to anon, authenticated using (true);
create policy "public reads" on public.skills for select to anon, authenticated using (true);
create policy "public reads" on public.skill_levels for select to anon, authenticated using (true);

-- Jobs.
create policy "public reads published" on public.jobs for select to anon, authenticated using (status = 'published');
create policy "public reads published" on public.job_skills for select to anon, authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published'));

-- Applications.
create policy "candidate reads own" on public.applications for select to authenticated
  using (candidate_id = (select auth.uid()));
create policy "candidate applies" on public.applications for insert to authenticated
  with check (candidate_id = (select auth.uid()));
create policy "org updates status" on public.applications for update to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
create policy "candidate reads own" on public.application_status_history for select to authenticated using (
  exists (select 1 from public.applications a where a.id = application_id and a.candidate_id = (select auth.uid()))
);

-- What a candidate can see of an assessment: only what they were invited to, never the rubric.
create policy "candidate reads invited" on public.assessments for select to authenticated
  using (private.candidate_has_assessment(id));
create policy "candidate reads invited" on public.assessment_versions for select to authenticated
  using (private.candidate_has_version(id));
create policy "candidate reads invited" on public.assessment_tasks for select to authenticated
  using (private.candidate_has_version(version_id));

-- Attempts change state only through start_attempt and submit_attempt.
create policy "candidate reads own" on public.assessment_attempts for select to authenticated
  using (candidate_id = (select auth.uid()));
create policy "org invites" on public.assessment_attempts for insert to authenticated
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));

-- The organization sees work only after the candidate submits.
create policy "candidate reads own" on public.task_responses for select to authenticated
  using (candidate_id = (select auth.uid()));
create policy "candidate writes own" on public.task_responses for insert to authenticated
  with check (candidate_id = (select auth.uid()));
create policy "candidate updates own" on public.task_responses for update to authenticated
  using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
create policy "org reads submitted" on public.task_responses for select to authenticated
  using (private.is_org_member(org_id) and private.attempt_submitted(attempt_id));

create policy "candidate reads own" on public.evidence_files for select to authenticated
  using (candidate_id = (select auth.uid()));
create policy "candidate writes own" on public.evidence_files for insert to authenticated
  with check (candidate_id = (select auth.uid()));
create policy "org reads submitted" on public.evidence_files for select to authenticated
  using (private.is_org_member(org_id) and private.attempt_submitted(attempt_id));

-- Candidates see results only after release. evaluation_reviews has no candidate policy at all.
create policy "candidate reads released" on public.evaluation_results for select to authenticated
  using (private.result_released_to_me(id));
create policy "candidate reads released" on public.criterion_scores for select to authenticated
  using (private.result_released_to_me(result_id));
create policy "candidate reads released" on public.skill_scores for select to authenticated
  using (private.result_released_to_me(result_id));

create policy "reviewers add notes" on public.evaluation_reviews for insert to authenticated with check (
  reviewer_id = (select auth.uid())
  and private.is_org_member(org_id, array['owner', 'admin', 'reviewer']::public.org_role[])
);

create policy "admins read" on public.audit_logs for select to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin']::public.org_role[]));

-- Grants. RLS decides which rows; these decide which operations exist at all.
grant select on public.organizations, public.organization_branding, public.jobs, public.job_skills,
  public.skills, public.skill_categories, public.skill_levels to anon;

grant select on all tables in schema public to authenticated;
grant update (email) on public.users to service_role;
grant update (display_name, preferred_locale) on public.users to authenticated;
grant insert, update, delete on public.candidate_profiles, public.candidate_skills to authenticated;
grant update (slug, name_ar, name_en, description) on public.organizations to authenticated;
grant insert, update, delete on public.organization_members, public.organization_invitations to authenticated;
grant update on public.organization_branding to authenticated;
grant insert, update, delete on public.jobs, public.job_skills, public.assessments, public.assessment_versions,
  public.assessment_tasks, public.rubric_criteria, public.task_skill_mappings to authenticated;
grant insert on public.applications to authenticated;
grant update (status) on public.applications to authenticated;
grant insert on public.assessment_attempts to authenticated;
grant insert, update on public.task_responses to authenticated;
grant insert on public.evidence_files to authenticated;
grant insert, update on public.evaluation_results, public.criterion_scores, public.skill_scores to authenticated;
grant insert on public.evaluation_reviews to authenticated;
