-- Database checks for the Phase 1 security fixes: candidate documents (S1), application status transitions and hiring
-- (S2), and links in finished queue jobs (S5). Everything runs in one transaction and is rolled back, so it leaves nothing.
-- Run against the local database only, never a hosted project:
--
--   scripts/local-db.sh psql -f supabase/tests/security_phase1.sql
--
-- Any failed check stops the script with an error naming it.
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- People. Sign-up goes through the real gate (the local access code) and the candidates through real provisioning.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000c001', 'phase1-candidate@example.com', '{"account_type": "candidate", "display_name": "Phase One Candidate", "midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-8000-00000000c002', 'phase1-other@example.com', '{"account_type": "candidate", "display_name": "Phase One Other", "midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-8000-00000000a001', 'phase1-owner-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-8000-00000000a002', 'phase1-reviewer-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-8000-00000000b001', 'phase1-owner-b@example.com', '{"midan_test_access": "local-dev-access"}', now());

insert into public.organizations (id, slug, name_ar, name_en) values
  ('00000000-0000-4000-8000-0000000000a0', 'phase1-org-a', 'المنظمة أ', 'Organization A'),
  ('00000000-0000-4000-8000-0000000000b0', 'phase1-org-b', 'المنظمة ب', 'Organization B');
insert into public.organization_members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000a002', 'reviewer'),
  ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-00000000b001', 'owner');

-- Jobs: A1 has a published assessment, A2 and B1 have none.
insert into public.jobs (id, org_id, slug, title_ar, title_en, status) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000a0', 'phase1-job-a1', 'وظيفة أ1', 'Job A1', 'published'),
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-0000000000a0', 'phase1-job-a2', 'وظيفة أ2', 'Job A2', 'published'),
  ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000000b0', 'phase1-job-b1', 'وظيفة ب1', 'Job B1', 'published');
insert into public.assessments (id, org_id, job_id, title_ar, title_en) values
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000001a1', 'تقييم', 'Assessment');
insert into public.assessment_versions (id, assessment_id, org_id, version_number) values
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000000a0', 1);
insert into public.assessment_tasks (id, version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000000a0', 1, 'written_case_study', 'مهمة', 'Task', 'اكتب', 'Write');
insert into public.rubric_criteria (task_id, org_id, code, description_ar, description_en, max_score) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000000a0', 'C1', 'معيار', 'Criterion', 10);
-- Publishing needs an owner or admin, so it's done with organization A's owner as the caller.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
update public.assessment_versions set status = 'published' where id = '00000000-0000-4000-8000-0000000003a1';

-- Each candidate has a current CV. Files are rows, as Storage keeps them; the bytes don't matter here.
update public.candidate_profiles set cv_path = user_id || '/cv-current.pdf'
where user_id in ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c002');
insert into storage.objects (bucket_id, name) values
  ('candidate-documents', '00000000-0000-4000-8000-00000000c001/cv-current.pdf'),
  ('candidate-documents', '00000000-0000-4000-8000-00000000c001/applications/00000000-0000-4000-8000-0000000001a1/snap-a.pdf'),
  ('candidate-documents', '00000000-0000-4000-8000-00000000c001/applications/00000000-0000-4000-8000-0000000001b1/snap-b.pdf'),
  ('candidate-documents', '00000000-0000-4000-8000-00000000c001/notes.pdf'),
  ('candidate-documents', '00000000-0000-4000-8000-00000000c002/cv-current.pdf');

-- Applications, made by the candidates themselves: the candidate to A1 and B1, each with its own CV copy; the other
-- candidate to A2 without a copy, so organization A falls back to that candidate's current CV.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local role authenticated;
insert into public.applications (id, job_id, candidate_id, cv_snapshot_path) values
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000c001',
    '00000000-0000-4000-8000-00000000c001/applications/00000000-0000-4000-8000-0000000001a1/snap-a.pdf'),
  ('00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-00000000c001',
    '00000000-0000-4000-8000-00000000c001/applications/00000000-0000-4000-8000-0000000001b1/snap-b.pdf');
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c002", "role": "authenticated"}';
set local role authenticated;
insert into public.applications (id, job_id, candidate_id) values
  ('00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-00000000c002');
reset role;

-- Visible candidate documents for whoever the claims name, through the same policies the Storage list endpoint uses.
-- The schema exists only inside this transaction.
create schema phase1_test;
create function phase1_test.visible(p_owner text) returns text[] language sql as $$
  select coalesce(array_agg(replace(name, p_owner || '/', '') order by name), '{}')
  from storage.objects where bucket_id = 'candidate-documents' and name like p_owner || '/%'
$$;
grant usage on schema phase1_test to authenticated, anon;

\echo 'S1: candidate documents'
-- Organization A: its own application's copy, nothing else of this candidate.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c001') = array['applications/00000000-0000-4000-8000-0000000001a1/snap-a.pdf'],
    'S1: organization A sees exactly its own application''s CV copy';
  assert not exists (select 1 from storage.objects where name like '%/00000000-0000-4000-8000-0000000001b1/%'),
    'S1: organization A cannot see, list or infer the application to organization B';
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c002') = array['cv-current.pdf'],
    'S1: without a copy, organization A reads the applicant''s current CV, as the API falls back to';
end $$;
reset role;

-- Organization A's reviewer: the same, since every member works on the organization's applicants.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a002", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c001') = array['applications/00000000-0000-4000-8000-0000000001a1/snap-a.pdf'],
    'S1: a reviewer of organization A sees the same copy';
end $$;
reset role;

-- Organization B: its own copy only, and nothing of the candidate who never applied to it.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c001') = array['applications/00000000-0000-4000-8000-0000000001b1/snap-b.pdf'],
    'S1: organization B sees exactly its own application''s CV copy';
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c002') = '{}', 'S1: organization B sees nothing of a candidate who never applied to it';
end $$;
reset role;

-- The candidate keeps their whole folder; another candidate and a signed-out visitor get nothing.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert cardinality(phase1_test.visible('00000000-0000-4000-8000-00000000c001')) = 4, 'S1: the candidate still sees all of their own files';
end $$;
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c002", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c001') = '{}', 'S1: another candidate sees nothing';
end $$;
reset role;
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
do $$ begin
  assert not exists (select 1 from storage.objects where bucket_id = 'candidate-documents'), 'S1: a signed-out visitor sees nothing';
end $$;
reset role;

\echo 'S2: application status transitions'
-- Applying to A1 assigned its published assessment straight away.
do $$ begin
  assert (select status from public.applications where id = '00000000-0000-4000-8000-0000000005a1') = 'assessment_invited',
    'S2: applying assigns the published assessment';
end $$;

-- Starting the attempt still moves the application on: system changes don't need the revoked table grant.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local role authenticated;
select public.start_attempt((select id from public.assessment_attempts where application_id = '00000000-0000-4000-8000-0000000005a1')) \gset ignored_
do $$ begin
  assert (select status from public.applications where id = '00000000-0000-4000-8000-0000000005a1') = 'assessment_in_progress',
    'S2: the assessment stage still follows the attempt';
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005a1', 'hired');
    assert false, 'S2: a candidate cannot change their own application';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$
declare s public.application_status;
begin
  -- The table itself can no longer be written by staff, so the rules can't be stepped around.
  begin
    update public.applications set status = 'hired' where id = '00000000-0000-4000-8000-0000000005a2';
    assert false, 'S2: a direct table update is refused';
  exception when insufficient_privilege then null;
  end;

  -- Assessment stages and "evaluated" are never set by hand.
  foreach s in array array['evaluated', 'assessment_invited', 'assessment_submitted']::public.application_status[] loop
    begin
      perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', s);
      assert false, format('S2: %s cannot be set by hand', s);
    exception when check_violation then null;
    end;
  end loop;

  -- Straight from submitted to hired is refused; the legitimate path works.
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', 'hired');
    assert false, 'S2: submitted cannot go straight to hired';
  exception when check_violation then null;
  end;
  perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', 'under_review');
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', 'submitted');
    assert false, 'S2: an application cannot be put back to submitted';
  exception when check_violation then null;
  end;
  perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', 'shortlisted');
  -- A job with no assessment has nothing to wait for.
  perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', 'hired');
  assert (select status from public.applications where id = '00000000-0000-4000-8000-0000000005a2') = 'hired', 'S2: shortlisted to hired';
  assert (select array_agg(to_status order by created_at, to_status) from public.application_status_history where application_id = '00000000-0000-4000-8000-0000000005a2')
    @> array['submitted', 'under_review', 'shortlisted', 'hired']::public.application_status[], 'S2: every change is in the history';
  assert (select bool_and(changed_by = '00000000-0000-4000-8000-00000000a001') from public.application_status_history
    where application_id = '00000000-0000-4000-8000-0000000005a2' and from_status is not null), 'S2: the history names who changed it';
  -- Hired is final.
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005a2', 'rejected');
    assert false, 'S2: a hired application cannot be changed';
  exception when check_violation then null;
  end;

  -- Another organization's application looks missing.
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005b1', 'rejected');
    assert false, 'S2: organization A cannot change organization B''s application';
  exception when sqlstate 'P0002' then null;
  end;

  -- Hiring waits for the assessment: shortlisting during it is fine, hiring isn't, by hand or by outcome.
  perform public.set_application_status('00000000-0000-4000-8000-0000000005a1', 'shortlisted');
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005a1', 'hired');
    assert false, 'S2: no hiring before the assessment is reviewed';
  exception when check_violation then null;
  end;
  begin
    insert into public.hiring_outcomes (application_id, org_id, candidate_id, outcome)
    values ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000c001', 'hired');
    assert false, 'S2: no hiring outcome before the assessment is reviewed';
  exception when check_violation then null;
  end;
  -- Decisions that aren't hiring stay open.
  insert into public.hiring_outcomes (application_id, org_id, candidate_id, outcome)
  values ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000c001', 'on_hold');
end $$;
reset role;

-- A reviewer evaluates; only owners, admins and recruiters decide.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a002", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005a1', 'rejected');
    assert false, 'S2: a reviewer cannot change an application''s status';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- The candidate submits, and the work is evaluated and reviewed by a person.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local role authenticated;
select public.submit_attempt((select id from public.assessment_attempts where application_id = '00000000-0000-4000-8000-0000000005a1')) \gset ignored_
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a002", "role": "authenticated"}';
insert into public.evaluation_results (attempt_id, org_id, status)
select id, org_id, 'needs_human_review' from public.assessment_attempts where application_id = '00000000-0000-4000-8000-0000000005a1';
update public.evaluation_results set status = 'reviewed'
where attempt_id = (select id from public.assessment_attempts where application_id = '00000000-0000-4000-8000-0000000005a1');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert (select status from public.applications where id = '00000000-0000-4000-8000-0000000005a1') = 'shortlisted',
    'S2: a review never overwrites a person''s decision';
  perform public.set_application_status('00000000-0000-4000-8000-0000000005a1', 'hired');
  assert (select status from public.applications where id = '00000000-0000-4000-8000-0000000005a1') = 'hired', 'S2: hiring once the assessment is reviewed';
end $$;
reset role;

-- A withdrawal ends everything, including organization B's access to its copy.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local role authenticated;
select public.withdraw_application('00000000-0000-4000-8000-0000000005b1') \gset ignored_
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000b001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform public.set_application_status('00000000-0000-4000-8000-0000000005b1', 'under_review');
    assert false, 'S2: a withdrawn application cannot be changed';
  exception when check_violation then null;
  end;
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c001') = '{}', 'S1: after a withdrawal the organization reads nothing';
end $$;
reset role;

\echo 'S5: links in finished queue jobs'
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c002", "role": "authenticated"}';
insert into public.cv_documents (id, candidate_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-4000-8000-0000000006c2', '00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c002/cv-current.pdf', 'application/pdf', 10);
insert into public.cv_analyses (id, document_id, candidate_id)
values ('00000000-0000-4000-8000-0000000007c2', '00000000-0000-4000-8000-0000000006c2', '00000000-0000-4000-8000-00000000c002');
set local role authenticated;
select id as job_id from public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007c2', '{"file_url": "https://storage.test/signed?token=secret"}') \gset
do $$ begin
  begin
    perform payload from public.background_jobs;
    assert false, 'S5: the payload, which holds the link, is not readable through the Data API';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role midan_worker;
select id from private.claim_background_job('phase1-worker', array['cv_analysis']) \gset claimed_
select status from private.settle_background_job(:'job_id', 'phase1-worker', true, '{}'::jsonb) \gset settled_
reset role;
do $$ begin
  assert not exists (select 1 from public.background_jobs where payload ? 'file_url' and status in ('succeeded', 'failed')),
    'S5: a finished job keeps no file link';
end $$;

\echo 'All Phase 1 database checks passed.'
rollback;
