-- Database checks for the assessment editing policy (20261107150000): employers add, edit and delete a draft's content; every
-- change is recorded with its state before and after; an owner or admin reviews the changes before approving; MIDAN's validation
-- shows what is no longer measured; approved versions never change, and a new version leaves existing attempts alone.
-- Everything runs in one transaction and is rolled back. Local database only, never a hosted project:
--
--   scripts/local-db.sh psql -f supabase/tests/assessment_editing_policy.sql
--
-- Any failed check stops the script with an error naming it.
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- People: organization A's owner, recruiter and reviewer, organization B's owner, and two candidates.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-4000-9000-00000000a001', 'policy-owner-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9000-00000000a002', 'policy-recruiter-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9000-00000000a003', 'policy-reviewer-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9000-00000000b001', 'policy-owner-b@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9000-00000000c001', 'policy-candidate-1@example.com', '{"account_type": "candidate", "display_name": "Policy One", "midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-9000-00000000c002', 'policy-candidate-2@example.com', '{"account_type": "candidate", "display_name": "Policy Two", "midan_test_access": "local-dev-access"}', now());
insert into public.organizations (id, slug, name_ar, name_en) values
  ('00000000-0000-4000-9000-0000000000a0', 'policy-org-a', 'المنظمة أ', 'Organization A'),
  ('00000000-0000-4000-9000-0000000000b0', 'policy-org-b', 'المنظمة ب', 'Organization B');
insert into public.organization_members (org_id, user_id, role) values
  ('00000000-0000-4000-9000-0000000000a0', '00000000-0000-4000-9000-00000000a001', 'owner'),
  ('00000000-0000-4000-9000-0000000000a0', '00000000-0000-4000-9000-00000000a002', 'recruiter'),
  ('00000000-0000-4000-9000-0000000000a0', '00000000-0000-4000-9000-00000000a003', 'reviewer'),
  ('00000000-0000-4000-9000-0000000000b0', '00000000-0000-4000-9000-00000000b001', 'owner');

-- A job with a mandatory responsibility and a required workbook skill: what the assessment has to keep measuring.
insert into public.jobs (id, org_id, slug, title_ar, title_en, status) values
  ('00000000-0000-4000-9000-0000000001a1', '00000000-0000-4000-9000-0000000000a0', 'policy-accountant', 'محاسب', 'Accountant', 'published');
insert into public.job_requirements (id, job_id, org_id, requirement_type, description_ar, description_en, is_mandatory) values
  ('00000000-0000-4000-9000-0000000002a1', '00000000-0000-4000-9000-0000000001a1', '00000000-0000-4000-9000-0000000000a0', 'responsibility',
   'مطابقة الحسابات الشهرية', 'Reconcile the monthly accounts', true);
insert into public.reference_skills (id, sector_code, skill_kind, name_ar, source_file, source_sheet, source_row) values
  ('00000000-0000-4000-9000-0000000003a1', 'financial_services', 'technical', 'مطابقة الحسابات', 'policy-test', 'policy-test', 1);
insert into public.job_reference_skills (job_id, org_id, reference_skill_id, is_required) values
  ('00000000-0000-4000-9000-0000000001a1', '00000000-0000-4000-9000-0000000000a0', '00000000-0000-4000-9000-0000000003a1', true);

-- The generated draft, written the way the Core API writes one: as the person who asked, marked as MIDAN's generation.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
set local midan.assessment_change to 'generation';
insert into public.assessments (id, org_id, job_id, title_ar, title_en) values
  ('00000000-0000-4000-9000-0000000004a1', '00000000-0000-4000-9000-0000000000a0', '00000000-0000-4000-9000-0000000001a1', 'تقييم المحاسب', 'Accountant assessment');
insert into public.assessment_versions (id, assessment_id, org_id, version_number) values
  ('00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000004a1', '00000000-0000-4000-9000-0000000000a0', 1);
insert into public.assessment_tasks (id, version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en, config, reference_skill_ids) values
  ('00000000-0000-4000-9000-0000000006a1', '00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', 1, 'written_case_study',
   'مطابقة حسابات', 'Reconcile accounts', 'طابق الحسابات المرفقة', 'Reconcile the attached accounts', '{}', '{00000000-0000-4000-9000-0000000003a1}'),
  ('00000000-0000-4000-9000-0000000006a2', '00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', 2, 'objective_questions',
   'أسئلة قصيرة', 'Short questions', 'اختر الإجابة الأفضل', 'Choose the best answer',
   '{"questions": [{"id": "q1", "text_ar": "س", "text_en": "Q", "options": [{"id": "a", "label_en": "A"}, {"id": "b", "label_en": "B"}]}]}', '{}');
insert into public.rubric_criteria (id, task_id, org_id, code, description_ar, description_en, max_score, requirement_id, reference_skill_id, answer_key) values
  ('00000000-0000-4000-9000-0000000007a1', '00000000-0000-4000-9000-0000000006a1', '00000000-0000-4000-9000-0000000000a0', 'C1', 'يطابق بدقة', 'Reconciles accurately', 10,
   '00000000-0000-4000-9000-0000000002a1', '00000000-0000-4000-9000-0000000003a1', null),
  ('00000000-0000-4000-9000-0000000007a2', '00000000-0000-4000-9000-0000000006a1', '00000000-0000-4000-9000-0000000000a0', 'C2', 'يشرح خطواته', 'Explains the steps', 10, null, null, null),
  ('00000000-0000-4000-9000-0000000007a3', '00000000-0000-4000-9000-0000000006a2', '00000000-0000-4000-9000-0000000000a0', 'C1', 'الإجابات الصحيحة', 'Correct answers', 1, null, null, '{"q1": "a"}');
insert into public.task_requirement_mappings (task_id, requirement_id, org_id) values
  ('00000000-0000-4000-9000-0000000006a1', '00000000-0000-4000-9000-0000000002a1', '00000000-0000-4000-9000-0000000000a0');
select id is not null as recorded from public.record_generated_draft('00000000-0000-4000-9000-0000000005a1') \gset generated_
set local midan.assessment_change to '';
reset role;

\echo 'Generated draft'
do $$ begin
  assert (select jsonb_array_length(content -> 'tasks') from public.assessment_version_snapshots
    where version_id = '00000000-0000-4000-9000-0000000005a1' and kind = 'generated') = 2, 'MIDAN keeps the draft it generated';
  assert private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1') is null, 'generation is MIDAN''s work, not an edit to review';
  assert (select bool_and(details ->> 'source' = 'generation') from public.audit_logs
    where details ->> 'version_id' = '00000000-0000-4000-9000-0000000005a1'), 'generation is recorded as generation';
  assert not exists (select 1 from jsonb_array_elements(private.validate_assessment_version('00000000-0000-4000-9000-0000000005a1')) f
    where f ->> 'severity' = 'error' or f ->> 'code' in ('requirement_not_measured', 'required_skill_not_measured')),
    'the generated draft measures everything the job requires';
  -- Its general objective questions aren't tied to anything the job states, and validation says so rather than staying quiet.
  assert exists (select 1 from jsonb_array_elements(private.validate_assessment_version('00000000-0000-4000-9000-0000000005a1')) f
    where f ->> 'code' = 'task_not_mapped' and f ->> 'task_id' = '00000000-0000-4000-9000-0000000006a2'), 'an unmapped task is shown';
end $$;

\echo 'Employer edits: add, edit, delete, each recorded'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
set local midan.change_reason to 'Match how this branch works';
-- Add a task and its criterion.
insert into public.assessment_tasks (id, version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en) values
  ('00000000-0000-4000-9000-0000000006a3', '00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', 3, 'written_case_study',
   'تقرير قصير', 'Short report', 'اكتب تقريرًا', 'Write a report');
insert into public.rubric_criteria (id, task_id, org_id, code, description_ar, description_en, max_score) values
  ('00000000-0000-4000-9000-0000000007a4', '00000000-0000-4000-9000-0000000006a3', '00000000-0000-4000-9000-0000000000a0', 'C1', 'واضح', 'Clear', 5);
-- Edit a task's text, an objective question's options and its answer key, and a rubric criterion.
update public.assessment_tasks set title_en = 'Reconcile the branch accounts', instructions_en = 'Reconcile the branch accounts attached'
  where id = '00000000-0000-4000-9000-0000000006a1';
update public.assessment_tasks set config = jsonb_set(config, '{questions,0,options}', '[{"id": "a", "label_en": "A"}, {"id": "b", "label_en": "B"}, {"id": "c", "label_en": "C"}]')
  where id = '00000000-0000-4000-9000-0000000006a2';
update public.rubric_criteria set answer_key = '{"q1": "c"}' where id = '00000000-0000-4000-9000-0000000007a3';
update public.rubric_criteria set description_en = 'Explains each step' where id = '00000000-0000-4000-9000-0000000007a2';
-- Delete the added task, with its criterion.
set local midan.change_reason to '';
delete from public.assessment_tasks where id = '00000000-0000-4000-9000-0000000006a3';
reset role;

do $$
declare n integer; a public.audit_logs;
begin
  select count(*) into n from public.audit_logs where details ->> 'version_id' = '00000000-0000-4000-9000-0000000005a1' and details ->> 'source' = 'edit';
  assert n = 7, format('every change is recorded: expected 7, got %s', n);

  select * into a from public.audit_logs where entity = 'assessment_tasks' and action = 'create' and entity_id = '00000000-0000-4000-9000-0000000006a3';
  assert a.actor_id = '00000000-0000-4000-9000-00000000a002' and a.org_id = '00000000-0000-4000-9000-0000000000a0', 'an addition names who and which organization';
  assert a.details -> 'old' = 'null' and a.details -> 'new' ->> 'title_en' = 'Short report', 'an addition keeps the new state';
  assert a.details ->> 'reason' = 'Match how this branch works', 'the reason given is kept';
  assert a.details ->> 'assessment_id' = '00000000-0000-4000-9000-0000000004a1' and a.details ->> 'version_number' = '1', 'it names the assessment and the draft version';
  assert a.created_at is not null, 'it has a time';

  select * into a from public.audit_logs where entity = 'assessment_tasks' and action = 'update' and entity_id = '00000000-0000-4000-9000-0000000006a1';
  assert a.details -> 'old' ->> 'title_en' = 'Reconcile accounts' and a.details -> 'new' ->> 'title_en' = 'Reconcile the branch accounts', 'an edit keeps the previous and the new state';
  assert a.details ->> 'task_id' = '00000000-0000-4000-9000-0000000006a1', 'an edit names the task';

  select * into a from public.audit_logs where entity = 'rubric_criteria' and action = 'update' and entity_id = '00000000-0000-4000-9000-0000000007a3';
  assert a.details -> 'old' -> 'answer_key' ->> 'q1' = 'a' and a.details -> 'new' -> 'answer_key' ->> 'q1' = 'c', 'an answer key change keeps both keys';
  assert a.details ->> 'criterion_id' = '00000000-0000-4000-9000-0000000007a3', 'a criterion change names the criterion';
  assert exists (select 1 from public.audit_logs where entity = 'assessment_tasks' and action = 'update' and entity_id = '00000000-0000-4000-9000-0000000006a2'
    and jsonb_array_length(details -> 'new' -> 'config' -> 'questions' -> 0 -> 'options') = 3), 'an options change is recorded';

  select * into a from public.audit_logs where entity = 'assessment_tasks' and action = 'delete' and entity_id = '00000000-0000-4000-9000-0000000006a3';
  assert a.details -> 'new' = 'null' and a.details -> 'old' ->> 'title_en' = 'Short report', 'a deletion keeps the previous state';
  assert a.details -> 'old' -> 'rubric_criteria' -> 0 ->> 'id' = '00000000-0000-4000-9000-0000000007a4', 'a deletion keeps the rubric that went with it';
  assert a.details ->> 'reason' is null, 'no reason recorded when none was given';
  assert not exists (select 1 from public.assessment_tasks where id = '00000000-0000-4000-9000-0000000006a3'), 'the task is gone from the draft';
end $$;

\echo 'The review state the screen shows'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
do $$
declare s jsonb := public.assessment_review_state('00000000-0000-4000-9000-0000000005a1');
begin
  assert s -> 'original' ->> 'kind' = 'generated', 'the original is the generated draft';
  assert jsonb_array_length(s -> 'changes') = 7 and (s ->> 'unreviewed')::boolean, 'every change is listed, unreviewed';
  assert (s ->> 'latest_change_id')::bigint = (select max((c ->> 'id')::bigint) from jsonb_array_elements(s -> 'changes') c), 'it names the last change to review';
  assert jsonb_array_length(s -> 'current' -> 'tasks') = 2 and jsonb_array_length(s -> 'original' -> 'content' -> 'tasks') = 2, 'original and current side by side';
  assert (select count(*) from jsonb_array_elements(s -> 'changes') c where c ->> 'actor_name' = 'policy-recruiter-a@example.com') = 7, 'each change names who made it';
end $$;
reset role;

\echo 'Refused: other roles, other organizations, candidates'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a003", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform public.assessment_review_state('00000000-0000-4000-9000-0000000005a1');
    assert false, 'a reviewer of candidates does not see the draft''s change history';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    insert into public.assessment_tasks (version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en)
    values ('00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', 9, 'written_case_study', 'x', 'x', 'x', 'x');
    assert false, 'a reviewer cannot add a task';
  exception when insufficient_privilege then null;
  end;
  update public.assessment_tasks set title_en = 'Reviewer edit' where id = '00000000-0000-4000-9000-0000000006a1';
  delete from public.assessment_tasks where id = '00000000-0000-4000-9000-0000000006a2';
end $$;
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000b001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  update public.assessment_tasks set title_en = 'Other organization' where id = '00000000-0000-4000-9000-0000000006a1';
  update public.rubric_criteria set answer_key = '{"q1": "b"}' where id = '00000000-0000-4000-9000-0000000007a3';
  begin
    perform public.assessment_version_changes('00000000-0000-4000-9000-0000000005a1');
    assert false, 'another organization cannot read the changes';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000c001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  update public.assessment_tasks set title_en = 'Candidate edit' where id = '00000000-0000-4000-9000-0000000006a1';
  begin
    perform public.create_assessment_revision('00000000-0000-4000-9000-0000000005a1');
    assert false, 'a candidate cannot start a version';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select title_en from public.assessment_tasks where id = '00000000-0000-4000-9000-0000000006a1') = 'Reconcile the branch accounts',
    'refused roles changed nothing';
  assert exists (select 1 from public.assessment_tasks where id = '00000000-0000-4000-9000-0000000006a2'), 'a reviewer deleted nothing';
  assert (select answer_key ->> 'q1' from public.rubric_criteria where id = '00000000-0000-4000-9000-0000000007a3') = 'c', 'another organization changed nothing';
  assert (select count(*) from public.audit_logs where details ->> 'version_id' = '00000000-0000-4000-9000-0000000005a1' and details ->> 'source' = 'edit') = 7,
    'refused attempts leave no records';
end $$;

\echo 'The audit trail and kept versions cannot be changed by employers'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert (select count(*) from public.audit_logs where details ->> 'version_id' = '00000000-0000-4000-9000-0000000005a1' and details ->> 'source' = 'edit') = 7,
    'the owner can read the record';
  begin
    update public.audit_logs set details = '{}' where details ->> 'version_id' = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'an owner cannot edit audit records';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs where details ->> 'version_id' = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'an owner cannot delete audit records';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.audit_logs (org_id, actor_id, action, entity, details) values ('00000000-0000-4000-9000-0000000000a0', auth.uid(), 'update', 'assessment_tasks', '{}');
    assert false, 'an owner cannot write audit records';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assessment_version_snapshots set content = '{}' where version_id = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'an owner cannot change the generated draft MIDAN kept';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.assessment_version_snapshots where version_id = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'an owner cannot delete the generated draft MIDAN kept';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assessment_change_reviews (version_id, org_id, reviewed_by, change_count, validation)
    values ('00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', auth.uid(), 0, '[]');
    assert false, 'a review is recorded only through the review';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'MIDAN validation shows what an edit no longer measures'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
-- Remove what tied the first task to the job's responsibility and required skill.
update public.assessment_tasks set reference_skill_ids = '{}' where id = '00000000-0000-4000-9000-0000000006a1';
update public.rubric_criteria set requirement_id = null, reference_skill_id = null where id = '00000000-0000-4000-9000-0000000007a1';
delete from public.task_requirement_mappings where task_id = '00000000-0000-4000-9000-0000000006a1';
-- And a second, identical task.
insert into public.assessment_tasks (id, version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en) values
  ('00000000-0000-4000-9000-0000000006a4', '00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', 3, 'written_case_study',
   'مطابقة حسابات', 'Reconcile again', 'نص آخر', 'Other text');
insert into public.rubric_criteria (task_id, org_id, code, description_ar, description_en, max_score) values
  ('00000000-0000-4000-9000-0000000006a4', '00000000-0000-4000-9000-0000000000a0', 'C1', 'واضح', 'Clear', 5);
do $$
declare codes text[];
begin
  select array_agg(f ->> 'code' order by f ->> 'code') into codes from jsonb_array_elements(public.assessment_validation('00000000-0000-4000-9000-0000000005a1')) f;
  assert 'requirement_not_measured' = any (codes), 'a responsibility no task measures is shown';
  assert 'required_skill_not_measured' = any (codes), 'a required workbook skill no task measures is shown';
  assert 'duplicate_task' = any (codes), 'a duplicate task is shown';
  assert 'task_not_mapped' = any (codes), 'a task tied to nothing the job states is shown';
  assert 'written_task_single_criterion' = any (codes), 'a written task with one criterion is shown';
  assert not exists (select 1 from jsonb_array_elements(public.assessment_validation('00000000-0000-4000-9000-0000000005a1')) f where f ->> 'severity' = 'error'),
    'those are warnings, not errors';
end $$;
reset role;

\echo 'Review before approval'
do $$ begin
  -- The owner can't approve yet: there are changes nobody has reviewed.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}', true);
  begin
    update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'no approval before the changes are reviewed';
  exception when check_violation then null;
  end;
  -- Only an owner or admin reviews.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}', true);
  begin
    perform public.review_assessment_changes('00000000-0000-4000-9000-0000000005a1', private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1'));
    assert false, 'a recruiter cannot review the changes';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a003", "role": "authenticated"}', true);
  begin
    perform public.review_assessment_changes('00000000-0000-4000-9000-0000000005a1', private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1'));
    assert false, 'a reviewer of candidates cannot review assessment changes';
  exception when insufficient_privilege then null;
  end;
  -- A review must cover the latest change: one made after the reviewer looked isn't approved by accident.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}', true);
  begin
    perform public.review_assessment_changes('00000000-0000-4000-9000-0000000005a1', private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1') - 1);
    assert false, 'a stale review is refused';
  exception when check_violation then null;
  end;
  -- The review records who, up to which change, and the validation the reviewer saw, warnings included.
  perform public.review_assessment_changes('00000000-0000-4000-9000-0000000005a1', private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1'), 'Coverage gaps accepted for now');
  assert (select reviewed_by from public.assessment_change_reviews where version_id = '00000000-0000-4000-9000-0000000005a1') = '00000000-0000-4000-9000-00000000a001',
    'the review names the reviewer';
  -- 7 edits first, then 5: the task's skills, the criterion's links, the mapping removed, the duplicate task and its criterion.
  assert (select change_count from public.assessment_change_reviews where version_id = '00000000-0000-4000-9000-0000000005a1') = 12, 'the review counts every change';
  assert exists (select 1 from public.assessment_change_reviews r, jsonb_array_elements(r.validation) f
    where r.version_id = '00000000-0000-4000-9000-0000000005a1' and f ->> 'code' = 'required_skill_not_measured'),
    'the review keeps the weakened coverage the reviewer was shown';

  -- A change after the review needs another review.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}', true);
  perform set_config('midan.change_reason', 'Restore the responsibility', true);
  set local role authenticated;
  insert into public.task_requirement_mappings (task_id, requirement_id, org_id)
  values ('00000000-0000-4000-9000-0000000006a1', '00000000-0000-4000-9000-0000000002a1', '00000000-0000-4000-9000-0000000000a0');
  update public.assessment_tasks set reference_skill_ids = '{00000000-0000-4000-9000-0000000003a1}' where id = '00000000-0000-4000-9000-0000000006a1';
  -- An answer key naming an option that doesn't exist: an error, which blocks approval even after review.
  update public.rubric_criteria set answer_key = '{"q1": "z"}' where id = '00000000-0000-4000-9000-0000000007a3';
  reset role;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}', true);
  begin
    update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'a change after the review needs another review';
  exception when check_violation then null;
  end;
  assert exists (select 1 from jsonb_array_elements(public.assessment_validation('00000000-0000-4000-9000-0000000005a1')) f
    where f ->> 'code' = 'objective_answer_invalid' and f ->> 'severity' = 'error'), 'an answer that is not an option is an error';
  perform public.review_assessment_changes('00000000-0000-4000-9000-0000000005a1', private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1'));
  begin
    update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9000-0000000005a1';
    assert false, 'errors block approval';
  exception when check_violation then null;
  end;
end $$;

-- Fixed, reviewed again, approved.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
update public.rubric_criteria set answer_key = '{"q1": "c"}' where id = '00000000-0000-4000-9000-0000000007a3';
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9000-0000000005a1';
    -- RLS may simply not match for a recruiter; either way the version must stay a draft.
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select status from public.assessment_versions where id = '00000000-0000-4000-9000-0000000005a1') = 'draft', 'a recruiter cannot approve';
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}', true);
  perform public.review_assessment_changes('00000000-0000-4000-9000-0000000005a1', private.latest_reviewable_change('00000000-0000-4000-9000-0000000005a1'), 'Checked');
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}';
set local role authenticated;
update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-9000-0000000005a1';
reset role;

\echo 'An approved version never changes'
do $$ begin
  assert (select published_by from public.assessment_versions where id = '00000000-0000-4000-9000-0000000005a1') = '00000000-0000-4000-9000-00000000a001',
    'the approval names who approved';
  assert (select content from public.assessment_version_snapshots where version_id = '00000000-0000-4000-9000-0000000005a1' and kind = 'approved')
    = private.assessment_version_content('00000000-0000-4000-9000-0000000005a1'), 'MIDAN keeps the approved version';
  assert (select content from public.assessment_version_snapshots where version_id = '00000000-0000-4000-9000-0000000005a1' and kind = 'generated')
    <> private.assessment_version_content('00000000-0000-4000-9000-0000000005a1'), 'the generated draft is kept apart from the edited one';
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    update public.assessment_tasks set title_en = 'Too late' where id = '00000000-0000-4000-9000-0000000006a1';
    assert false, 'a published task cannot change';
  exception when check_violation then null;
  end;
  begin
    delete from public.rubric_criteria where id = '00000000-0000-4000-9000-0000000007a2';
    assert false, 'a published criterion cannot be deleted';
  exception when check_violation then null;
  end;
  begin
    insert into public.assessment_tasks (version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en)
    values ('00000000-0000-4000-9000-0000000005a1', '00000000-0000-4000-9000-0000000000a0', 9, 'written_case_study', 'x', 'x', 'x', 'x');
    assert false, 'nothing can be added to a published version';
  exception when check_violation then null;
  end;
end $$;
reset role;

\echo 'Changing an assessment candidates take: a new version, old attempts untouched'
-- The first candidate applies and is given version 1.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000c001", "role": "authenticated"}';
set local role authenticated;
insert into public.applications (id, job_id, candidate_id) values
  ('00000000-0000-4000-9000-0000000008c1', '00000000-0000-4000-9000-0000000001a1', '00000000-0000-4000-9000-00000000c001');
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}';
set local role authenticated;
select id as v2 from public.create_assessment_revision('00000000-0000-4000-9000-0000000005a1') \gset
do $$ begin
  begin
    perform public.create_assessment_revision('00000000-0000-4000-9000-0000000005a1');
    assert false, 'one draft at a time';
  exception when check_violation then null;
  end;
end $$;
update public.assessment_tasks set title_en = 'Reconcile accounts, version two' where version_id = :'v2' and position = 1;
reset role;
do $$
declare v2 uuid := (select id from public.assessment_versions where assessment_id = '00000000-0000-4000-9000-0000000004a1' and version_number = 2);
begin
  assert (select status from public.assessment_versions where id = v2) = 'draft', 'the new version is a draft';
  assert (select based_on_version_id from public.assessment_version_snapshots where version_id = v2 and kind = 'revision_base') = '00000000-0000-4000-9000-0000000005a1',
    'MIDAN keeps what the new version started from';
  assert (select count(*) from public.assessment_tasks where version_id = v2) = (select count(*) from public.assessment_tasks where version_id = '00000000-0000-4000-9000-0000000005a1'),
    'the new version starts as a copy';
  assert (select count(*) from public.audit_logs where details ->> 'version_id' = v2::text and details ->> 'source' = 'edit') = 1,
    'the copy is not an edit; the change after it is';
  assert private.assessment_version_content('00000000-0000-4000-9000-0000000005a1')
    = (select content from public.assessment_version_snapshots where version_id = '00000000-0000-4000-9000-0000000005a1' and kind = 'approved'),
    'editing the new version leaves the approved one exactly as it was';
  assert (select version_id from public.assessment_attempts where application_id = '00000000-0000-4000-9000-0000000008c1') = '00000000-0000-4000-9000-0000000005a1',
    'the first candidate keeps version 1';
  begin
    perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a002", "role": "authenticated"}', true);
    perform public.record_generated_draft(v2);
    assert false, 'an edited copy cannot be passed off as generated';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}', true);
  perform public.review_assessment_changes(v2, private.latest_reviewable_change(v2));
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000a001", "role": "authenticated"}';
set local role authenticated;
update public.assessment_versions set status = 'published' where id = :'v2';
reset role;
-- A later candidate gets version 2; the first still has version 1, unchanged.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-00000000c002", "role": "authenticated"}';
set local role authenticated;
insert into public.applications (id, job_id, candidate_id) values
  ('00000000-0000-4000-9000-0000000008c2', '00000000-0000-4000-9000-0000000001a1', '00000000-0000-4000-9000-00000000c002');
reset role;
do $$ begin
  assert (select version_id from public.assessment_attempts where application_id = '00000000-0000-4000-9000-0000000008c2')
    = (select id from public.assessment_versions where assessment_id = '00000000-0000-4000-9000-0000000004a1' and version_number = 2),
    'a new candidate gets the new version';
  assert (select version_id from public.assessment_attempts where application_id = '00000000-0000-4000-9000-0000000008c1') = '00000000-0000-4000-9000-0000000005a1',
    'the first candidate still has version 1';
  assert (select title_en from public.assessment_tasks where version_id = '00000000-0000-4000-9000-0000000005a1' and position = 1) = 'Reconcile the branch accounts',
    'version 1 reads as it did when the first candidate got it';
end $$;

\echo 'All assessment editing policy checks passed.'
rollback;
