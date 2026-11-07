-- Read-only. What should be true once all ten migrations are in. Every row must say ok.
with checks(name, ok) as (values
  ('S1 storage policy uses the new function', exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'org reads applicant documents' and qual like '%can_view_candidate_document%')),
  ('S2 direct status policy is gone', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'applications' and policyname = 'org updates status')),
  ('S2 no direct update on applications', not has_table_privilege('authenticated', 'public.applications', 'update')),
  ('S2 status function callable by staff', has_function_privilege('authenticated', 'public.set_application_status(uuid, public.application_status)', 'execute')),
  ('S2 status function closed to signed-out', not has_function_privilege('anon', 'public.set_application_status(uuid, public.application_status)', 'execute')),
  ('S5 queue link not readable by signed-in', not has_column_privilege('authenticated', 'public.background_jobs', 'payload', 'select')),
  ('S5 queue link not readable by signed-out', not has_column_privilege('anon', 'public.background_jobs', 'payload', 'select')),
  ('S5 caller-named dedupe key is gone', to_regprocedure('public.enqueue_background_job(text, uuid, jsonb, text)') is null),
  ('S5 no finished job keeps a link', not exists (select 1 from public.background_jobs where status in ('succeeded', 'failed') and payload ? 'file_url')),
  ('Decision CV sharing function exists', to_regprocedure('public.share_cv_with_application(uuid, text)') is not null),
  ('Decision CV sharing closed to signed-out', not has_function_privilege('anon', 'public.share_cv_with_application(uuid, text)', 'execute')),
  ('Roles importer, worker and AI exist', (select count(*) = 3 from pg_roles where rolname in ('midan_importer', 'midan_worker', 'midan_ai'))),
  ('Worker role cannot log in', not (select rolcanlogin from pg_roles where rolname = 'midan_worker')),
  ('API role does not bypass row security', not (select rolbypassrls from pg_roles where rolname = 'midan_api')),
  ('Checkpoint schema belongs to the AI role', (select pg_get_userbyid(nspowner) = 'midan_ai' from pg_namespace where nspname = 'ai_checkpoints')),
  ('Row security on for every public table', not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)),
  -- 20261107120000 added write_audit to tasks and criteria; 20261107150000 replaced it with write_assessment_audit, which also
  -- records additions, content and reasons, and covers requirement links and the version's own fields.
  ('Edits to assessment drafts are audited', (select count(*) = 5 from pg_trigger where tgname in ('write_assessment_audit', 'write_assessment_audit_delete')
    and tgrelid in ('public.assessment_tasks'::regclass, 'public.rubric_criteria'::regclass, 'public.task_requirement_mappings'::regclass, 'public.assessment_versions'::regclass))
    and not exists (select 1 from pg_trigger where tgname = 'write_audit' and tgrelid in ('public.assessment_tasks'::regclass, 'public.rubric_criteria'::regclass))),
  ('Organizations read applications, not live candidate profiles', not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename in ('candidate_profiles', 'candidate_skills', 'candidate_reference_skills') and policyname in ('org reads applicants', 'org reads applicant skills'))),
  ('Only interview participants can join', exists (select 1 from pg_proc where proname = 'can_join_interview') and (select relrowsecurity from pg_class where oid = 'public.interview_participants'::regclass)),
  ('Listing source records are closed to signed-out visitors', not has_column_privilege('anon', 'public.external_job_listings', 'raw_record', 'select')),
  ('Listing review notes are closed to signed-in users', not has_column_privilege('authenticated', 'public.external_job_listings', 'review_note', 'select')),
  ('Job search text exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'search_text')),
  ('Claims have row security', (select relrowsecurity from pg_class where oid = 'public.employer_claims'::regclass)),
  ('Claims are never written directly', not has_table_privilege('authenticated', 'public.employer_claims', 'insert')),
  ('Claim evidence bucket is private', not (select public from storage.buckets where id = 'employer-claims')),
  ('Invitations closed to signed-out visitors', not has_function_privilege('anon', 'public.accept_organization_invitation(uuid)', 'execute')),
  ('Workbook skill scores have row security', (select relrowsecurity from pg_class where oid = 'public.reference_skill_scores'::regclass)),
  ('Only the three authorized job source types', (select regexp_count(pg_get_constraintdef(oid), '''[a-z_]+''::text') = 3 from pg_constraint where conrelid = 'public.external_job_listings'::regclass and conname = 'external_job_listings_source_type_check'))
)
select case when ok then 'ok   ' else 'FAIL ' end || name from checks;
