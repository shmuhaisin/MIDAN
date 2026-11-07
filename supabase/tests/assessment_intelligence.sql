-- Database checks for the MIDAN Assessment Standard (20261107160000): the assessor guide is readable by the organization's staff
-- and nobody else, never by a candidate; guide and package edits are audited and reviewed; quality reports come only from MIDAN's
-- service role; a version under the standard is approved only with a current "ready" report; approved versions stay immutable;
-- a revision carries the guide forward. Everything runs in one transaction and is rolled back. Local database only:
--
--   scripts/local-db.sh psql -f supabase/tests/assessment_intelligence.sql
--
-- Any failed check stops the script with an error naming it.
\set ON_ERROR_STOP on
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-4000-9100-00000000a001', 'mas-owner-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9100-00000000a002', 'mas-recruiter-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9100-00000000a003', 'mas-reviewer-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9100-00000000b001', 'mas-owner-b@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9100-00000000c001', 'mas-candidate@example.com', '{"account_type": "candidate", "display_name": "MAS Candidate", "midan_test_access": "local-dev-access"}', now());
insert into public.organizations (id, slug, name_ar, name_en) values
  ('00000000-0000-4000-9100-0000000000a0', 'mas-org-a', 'المنظمة أ', 'Organization A'),
  ('00000000-0000-4000-9100-0000000000b0', 'mas-org-b', 'المنظمة ب', 'Organization B');
insert into public.organization_members (org_id, user_id, role) values
  ('00000000-0000-4000-9100-0000000000a0', '00000000-0000-4000-9100-00000000a001', 'owner'),
  ('00000000-0000-4000-9100-0000000000a0', '00000000-0000-4000-9100-00000000a002', 'recruiter'),
  ('00000000-0000-4000-9100-0000000000a0', '00000000-0000-4000-9100-00000000a003', 'reviewer'),
  ('00000000-0000-4000-9100-0000000000b0', '00000000-0000-4000-9100-00000000b001', 'owner');
insert into public.jobs (id, org_id, slug, title_ar, title_en, status, sector, experience_level) values
  ('00000000-0000-4000-9100-0000000001a1', '00000000-0000-4000-9100-0000000000a0', 'mas-analyst', 'محلل', 'Analyst', 'published', 'digital', 'mid');
insert into public.job_requirements (id, job_id, org_id, requirement_type, description_ar, description_en, is_mandatory) values
  ('00000000-0000-4000-9100-0000000002a1', '00000000-0000-4000-9100-0000000001a1', '00000000-0000-4000-9100-0000000000a0', 'responsibility',
   'تحليل السجلات', 'Analyse the logs', true);

\echo 'Company type'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
update public.organizations set company_type = 'startup' where id = '00000000-0000-4000-9100-0000000000a0';
do $$ begin
  assert (select company_type from public.organizations where id = '00000000-0000-4000-9100-0000000000a0') = 'startup', 'an owner sets the company type';
  begin
    update public.organizations set company_type = 'unicorn' where id = '00000000-0000-4000-9100-0000000000a0';
    assert false, 'only the standard''s company types are accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;

\echo 'A generated draft under the standard'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a002", "role": "authenticated"}';
set local role authenticated;
set local midan.assessment_change to 'generation';
insert into public.assessments (id, org_id, job_id, title_ar, title_en) values
  ('00000000-0000-4000-9100-0000000004a1', '00000000-0000-4000-9100-0000000000a0', '00000000-0000-4000-9100-0000000001a1', 'تقييم', 'Assessment');
insert into public.assessment_versions (id, assessment_id, org_id, version_number, candidate_package) values
  ('00000000-0000-4000-9100-0000000005a1', '00000000-0000-4000-9100-0000000004a1', '00000000-0000-4000-9100-0000000000a0', 1,
   '{"standard_version": "MAS-1.0", "candidate_brief": {"scenario_en": "A fictional startup"}, "materials": []}');
insert into public.assessment_tasks (id, version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en, weight, config) values
  ('00000000-0000-4000-9100-0000000006a1', '00000000-0000-4000-9100-0000000005a1', '00000000-0000-4000-9100-0000000000a0', 1, 'written_case_study',
   'تحليل', 'Analyse', 'حلل السجلات', 'Analyse the logs', 100, '{"deliverable_ids": ["report"]}');
insert into public.rubric_criteria (id, task_id, org_id, code, description_ar, description_en, max_score, weight, requirement_id) values
  ('00000000-0000-4000-9100-0000000007a1', '00000000-0000-4000-9100-0000000006a1', '00000000-0000-4000-9100-0000000000a0', 'C1', 'دقة', 'Accuracy', 4, 60,
   '00000000-0000-4000-9100-0000000002a1'),
  ('00000000-0000-4000-9100-0000000007a2', '00000000-0000-4000-9100-0000000006a1', '00000000-0000-4000-9100-0000000000a0', 'C2', 'وضوح', 'Clarity', 4, 40, null);
insert into public.task_requirement_mappings (task_id, requirement_id, org_id) values
  ('00000000-0000-4000-9100-0000000006a1', '00000000-0000-4000-9100-0000000002a1', '00000000-0000-4000-9100-0000000000a0');
-- org_id is set from the version, whatever the writer sends.
insert into public.assessment_assessor_guides (version_id, org_id, standard_version, content) values
  ('00000000-0000-4000-9100-0000000005a1', '00000000-0000-4000-9100-0000000000a0', 'MAS-1.0',
   '{"assessor_guide": {"task_solutions": [{"task_ref": 1, "reference_solution": "SECRET-REFERENCE"}]}, "criteria_guidance": {}}');
select id is not null as recorded from public.record_generated_draft('00000000-0000-4000-9100-0000000005a1') \gset generated_
set local midan.assessment_change to '';
reset role;

do $$ begin
  assert (select content -> 'guide' -> 'content' -> 'assessor_guide' -> 'task_solutions' -> 0 ->> 'reference_solution'
          from public.assessment_version_snapshots where version_id = '00000000-0000-4000-9100-0000000005a1' and kind = 'generated') = 'SECRET-REFERENCE',
    'MIDAN''s kept copy of the generated draft includes its guide';
  assert (select content -> 'settings' -> 'candidate_package' ->> 'standard_version' from public.assessment_version_snapshots
          where version_id = '00000000-0000-4000-9100-0000000005a1' and kind = 'generated') = 'MAS-1.0', 'and its candidate package';
  assert exists (select 1 from public.audit_logs where entity = 'assessment_assessor_guides' and details ->> 'source' = 'generation'),
    'writing the guide during generation is recorded as generation';
  assert private.latest_reviewable_change('00000000-0000-4000-9100-0000000005a1') is null, 'nothing to review yet';
  assert private.is_under_standard('00000000-0000-4000-9100-0000000005a1'), 'the version is under the standard';
end $$;

\echo 'Who can read the assessor guide'
do $$
declare who text; n integer;
begin
  foreach who in array array['00000000-0000-4000-9100-00000000a001', '00000000-0000-4000-9100-00000000a002', '00000000-0000-4000-9100-00000000a003'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.assessment_assessor_guides where version_id = '00000000-0000-4000-9100-0000000005a1';
    reset role;
    assert n = 1, format('organization staff (%s) read the guide', who);
  end loop;
  foreach who in array array['00000000-0000-4000-9100-00000000b001', '00000000-0000-4000-9100-00000000c001'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.assessment_assessor_guides;
    assert n = 0, format('%s sees no guide', who);
    select count(*) into n from public.assessment_quality_reports;
    assert n = 0, format('%s sees no quality report', who);
    begin
      perform public.assessment_content_digest('00000000-0000-4000-9100-0000000005a1');
      assert false, 'outsiders get no digest';
    exception when sqlstate 'P0002' then null;
    end;
    begin
      update public.assessment_assessor_guides set content = '{"assessor_guide": {}}';
      get diagnostics n = row_count;
      assert n = 0, 'an outsider changes no guide';
    end;
    begin
      insert into public.assessment_assessor_guides (version_id, org_id, standard_version, content)
      values ('00000000-0000-4000-9100-0000000005a1', '00000000-0000-4000-9100-0000000000b0', 'MAS-1.0', '{"assessor_guide": {}}');
      assert false, 'an outsider writes no guide';
    exception when insufficient_privilege or unique_violation then null;
    end;
    reset role;
  end loop;
  -- Anonymous visitors don't even have the table.
  set local role anon;
  begin
    perform 1 from public.assessment_assessor_guides;
    assert false, 'anonymous visitors cannot read guides';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

\echo 'Guide and package edits are recorded and reviewed'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a002", "role": "authenticated"}';
set local role authenticated;
set local midan.change_reason to 'Clarify the reference solution';
update public.assessment_assessor_guides set content = jsonb_set(content, '{assessor_guide,scope_and_limits}', '"Investigation only"')
  where version_id = '00000000-0000-4000-9100-0000000005a1';
set local midan.change_reason to '';
update public.assessment_versions set candidate_package = jsonb_set(candidate_package, '{candidate_brief,scenario_en}', '"A fictional startup, edited"')
  where id = '00000000-0000-4000-9100-0000000005a1';
do $$ begin
  delete from public.assessment_assessor_guides where version_id = '00000000-0000-4000-9100-0000000005a1';
  assert false, 'a guide is never deleted on its own';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
declare a public.audit_logs;
begin
  select * into a from public.audit_logs where entity = 'assessment_assessor_guides' and action = 'update';
  assert a.actor_id = '00000000-0000-4000-9100-00000000a002' and a.details ->> 'source' = 'edit' and a.details ->> 'reason' = 'Clarify the reference solution',
    'a guide edit names who, why, and is a person''s edit';
  assert a.details -> 'new' -> 'content' -> 'assessor_guide' ->> 'scope_and_limits' = 'Investigation only' and a.details -> 'old' -> 'content' -> 'assessor_guide' ->> 'scope_and_limits' is null,
    'a guide edit keeps before and after';
  assert private.is_reviewable_change(a), 'a guide edit must be reviewed before approval';
  select * into a from public.audit_logs where entity = 'assessment_versions' and action = 'update' and details ->> 'version_id' = '00000000-0000-4000-9100-0000000005a1'
    order by id desc limit 1;
  assert a.details ->> 'kind' = 'content' and a.details -> 'new' -> 'candidate_package' -> 'candidate_brief' ->> 'scenario_en' = 'A fictional startup, edited',
    'a package edit is content, with before and after';
end $$;

\echo 'Quality reports come only from MIDAN''s service role'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform private.record_quality_report('00000000-0000-4000-9100-0000000005a1', 'x', '{"verdict": "ready", "dimensions": {}}');
    assert false, 'an owner cannot record a report';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assessment_quality_reports (version_id, org_id, standard_version, evaluator_version, verdict, overall_score, standardized, content_digest, report)
    values ('00000000-0000-4000-9100-0000000005a1', '00000000-0000-4000-9100-0000000000a0', 'MAS-1.0', 'x', 'ready', 100, true, 'x', '{}');
    assert false, 'an owner cannot write a report directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The owner reviews every change so far.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
select public.assessment_content_digest('00000000-0000-4000-9100-0000000005a1') as digest \gset
select (public.assessment_review_state('00000000-0000-4000-9100-0000000005a1') ->> 'latest_change_id')::bigint as latest \gset
select public.review_assessment_changes('00000000-0000-4000-9100-0000000005a1', :latest, 'Checked') is not null as reviewed \gset
reset role;

set local role midan_worker;
do $$ begin
  perform private.record_quality_report('00000000-0000-4000-9100-0000000005a1', 'stale-digest', '{"verdict": "ready", "dimensions": {}}');
  assert false, 'a report on content that has since changed is refused';
exception when check_violation then null;
end $$;
select private.record_quality_report('00000000-0000-4000-9100-0000000005a1', :'digest',
  '{"verdict": "blocked", "overall_score": 40, "standardized": true, "standard_version": "MAS-1.0", "evaluator_version": "quality-v1", "dimensions": {}}') is not null as recorded \gset
reset role;

\echo 'The gate: approval needs a current, ready report'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9100-0000000005a1';
  assert false, 'a blocked report stops approval';
exception when check_violation then
  assert sqlerrm like '%does not meet the MIDAN Assessment Standard%', sqlerrm;
end $$;
reset role;

set local role midan_worker;
select private.record_quality_report('00000000-0000-4000-9100-0000000005a1', :'digest',
  '{"verdict": "ready", "overall_score": 92, "standardized": true, "standard_version": "MAS-1.0", "evaluator_version": "quality-v1", "dimensions": {}}') is not null as recorded \gset
reset role;
-- A change after the check: the ready report is stale.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a002", "role": "authenticated"}';
set local role authenticated;
update public.rubric_criteria set description_en = 'Accuracy of the timeline' where id = '00000000-0000-4000-9100-0000000007a1';
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
select (public.assessment_review_state('00000000-0000-4000-9100-0000000005a1') ->> 'latest_change_id')::bigint as latest \gset
select public.review_assessment_changes('00000000-0000-4000-9100-0000000005a1', :latest, null) is not null as reviewed \gset
do $$ begin
  update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9100-0000000005a1';
  assert false, 'a report on earlier content stops approval';
exception when check_violation then
  assert sqlerrm like '%Check this version against the MIDAN Assessment Standard%', sqlerrm;
end $$;
select public.assessment_content_digest('00000000-0000-4000-9100-0000000005a1') as digest \gset
reset role;
set local role midan_worker;
select private.record_quality_report('00000000-0000-4000-9100-0000000005a1', :'digest',
  '{"verdict": "ready", "overall_score": 92, "standardized": true, "standard_version": "MAS-1.0", "evaluator_version": "quality-v1", "dimensions": {}}') is not null as recorded \gset
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9100-0000000005a1';
reset role;

\echo 'Approved: guide immutable, no more reports'
do $$ begin
  assert (select status from public.assessment_versions where id = '00000000-0000-4000-9100-0000000005a1') = 'published', 'approved with a current ready report';
  assert (select content -> 'guide' is not null from public.assessment_version_snapshots where version_id = '00000000-0000-4000-9100-0000000005a1' and kind = 'approved'),
    'the approved copy includes the guide';
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  update public.assessment_assessor_guides set content = '{"assessor_guide": {}}' where version_id = '00000000-0000-4000-9100-0000000005a1';
  assert false, 'an approved version''s guide cannot change';
exception when check_violation then null;
end $$;
reset role;
set local role midan_worker;
do $$ begin
  perform private.record_quality_report('00000000-0000-4000-9100-0000000005a1', private.assessment_content_digest('00000000-0000-4000-9100-0000000005a1'),
    '{"verdict": "blocked", "dimensions": {}}');
  assert false, 'an approved version is not checked again';
exception when check_violation or insufficient_privilege then null;
end $$;
reset role;

\echo 'A revision carries the guide and package, and stays under the standard'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a002", "role": "authenticated"}';
set local role authenticated;
select id as revision from public.create_assessment_revision('00000000-0000-4000-9100-0000000005a1') \gset
reset role;
do $$
declare v uuid := (select id from public.assessment_versions where assessment_id = '00000000-0000-4000-9100-0000000004a1' and version_number = 2);
begin
  assert (select content -> 'assessor_guide' ->> 'scope_and_limits' from public.assessment_assessor_guides where version_id = v) = 'Investigation only',
    'the new draft starts with the approved guide';
  assert (select candidate_package -> 'candidate_brief' ->> 'scenario_en' from public.assessment_versions where id = v) = 'A fictional startup, edited',
    'and the approved package';
  assert (select content -> 'guide' is not null from public.assessment_version_snapshots where version_id = v and kind = 'revision_base'),
    'the revision''s starting copy includes them';
  assert (select bool_and(details ->> 'source' = 'revision') from public.audit_logs where details ->> 'version_id' = v::text), 'copying is the revision''s work';
  assert private.latest_reviewable_change(v) is null, 'nothing to review yet';
  assert private.is_under_standard(v), 'the revision is under the standard';
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9100-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  update public.assessment_versions set status = 'published' where assessment_id = '00000000-0000-4000-9100-0000000004a1' and version_number = 2;
  assert false, 'a revision is checked before approval like any version under the standard';
exception when check_violation then
  assert sqlerrm like '%Check this version against the MIDAN Assessment Standard%', sqlerrm;
end $$;
reset role;

\echo 'All assessment intelligence checks passed.'
rollback;
