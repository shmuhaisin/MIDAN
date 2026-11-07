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
  ('00000000-0000-4000-8000-00000000a003', 'phase1-recruiter-a@example.com', '{"midan_test_access": "local-dev-access"}', now()),
  ('00000000-0000-4000-8000-00000000b001', 'phase1-owner-b@example.com', '{"midan_test_access": "local-dev-access"}', now());

insert into public.organizations (id, slug, name_ar, name_en) values
  ('00000000-0000-4000-8000-0000000000a0', 'phase1-org-a', 'المنظمة أ', 'Organization A'),
  ('00000000-0000-4000-8000-0000000000b0', 'phase1-org-b', 'المنظمة ب', 'Organization B');
insert into public.organization_members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000a002', 'reviewer'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000a003', 'recruiter'),
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
-- Written as MIDAN's generation, as the Core API writes a draft, so approving it needs no review of people's changes
-- (supabase/tests/assessment_editing_policy.sql covers those).
set local midan.assessment_change to 'generation';
insert into public.assessment_tasks (id, version_id, org_id, position, task_type, title_ar, title_en, instructions_ar, instructions_en) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000000a0', 1, 'written_case_study', 'مهمة', 'Task', 'اكتب', 'Write');
insert into public.rubric_criteria (task_id, org_id, code, description_ar, description_en, max_score) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000000a0', 'C1', 'معيار', 'Criterion', 10);
set local midan.assessment_change to '';
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
-- candidate to A2 without a copy, so organization A sees no CV until that candidate chooses to share one.
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
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c002') = '{}',
    'S1: without a copy, organization A reads nothing, not even the applicant''s current CV';
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
select id as job_id from public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007c2', '{"file_url": "https://storage.test/storage/v1/object/sign/candidate-documents/00000000-0000-4000-8000-00000000c002/cv-current.pdf?token=secret"}') \gset
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

-- A second candidate, for what one person's calls may reach of another's job.
do $$ begin
  assert to_regprocedure('public.enqueue_background_job(text, uuid, jsonb, text)') is null,
    'S5: callers can no longer name a deduplication key, which could return another job';
  assert not exists (select 1 from pg_trigger where tgrelid = 'public.background_jobs'::regclass and tgname = 'write_audit'),
    'S5: queue rows are not copied into the audit log';
  assert not has_column_privilege('authenticated', 'public.background_jobs', 'payload', 'select'),
    'S5: no Data API role reads the payload';
  assert not has_column_privilege('anon', 'public.background_jobs', 'payload', 'select'),
    'S5: no Data API role reads the payload';
end $$;
do $$ begin
  perform set_config('phase1.link', '{"file_url": "https://storage.test/storage/v1/object/sign/candidate-documents/00000000-0000-4000-8000-00000000c002/cv-current.pdf?token=secret"}', true);
end $$;
insert into public.cv_analyses (id, document_id, candidate_id) values
  ('00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000006c2', '00000000-0000-4000-8000-00000000c002'),
  ('00000000-0000-4000-8000-0000000007d2', '00000000-0000-4000-8000-0000000006c2', '00000000-0000-4000-8000-00000000c002'),
  ('00000000-0000-4000-8000-0000000007d3', '00000000-0000-4000-8000-0000000006c2', '00000000-0000-4000-8000-00000000c002');
set local role authenticated;
do $$ declare first public.background_jobs; again public.background_jobs; begin
  select * into first from public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d1', current_setting('phase1.link')::jsonb);
  assert first.payload = '{}', 'S5: the function returns no payload';
  assert first.acting_email is null and first.locked_by is null, 'S5: the function returns no email or worker';
  select * into again from public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d1', '{}');
  assert again.id = first.id, 'S5: the same work is queued once';
  perform public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d2', current_setting('phase1.link')::jsonb);
end $$;
do $$ begin
  begin
    perform public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d3', '{"file_url": "http://169.254.169.254/latest/meta-data/?token=x"}');
    assert false, 'S5: a URL outside Storage is refused';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d3', '{"file_url": "https://storage.test/storage/v1/object/sign/candidate-documents/00000000-0000-4000-8000-00000000c001/cv.pdf?token=x"}');
    assert false, 'S5: a link into someone else''s folder is refused';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d3', '{"file_url": "https://storage.test/storage/v1/object/sign/candidate-documents/00000000-0000-4000-8000-00000000c002/cv.pdf?token=x", "other": 1}');
    assert false, 'S5: a CV job takes nothing but the link';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
-- Another candidate who knows the analysis id gets nothing from it, and can't reach that job.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform public.enqueue_background_job('cv_analysis', '00000000-0000-4000-8000-0000000007d1', '{}');
    assert false, 'S5: another candidate''s analysis is refused';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.background_jobs where id = '00000000-0000-4000-8000-0000000007d1' or subject_id = '00000000-0000-4000-8000-0000000007d1'),
    'S5: another candidate''s job is not visible';
end $$;
reset role;

-- Between retries the link stays, since the job needs it. When retries run out, or the failure is permanent, it goes.
do $$ declare j record; begin
  update public.background_jobs set run_after = now() - interval '1 second', created_at = now() - interval '1 hour' where subject_id = '00000000-0000-4000-8000-0000000007d1';
end $$;
set local role midan_worker;
do $$ declare claimed record; settled record; begin
  select * into claimed from private.claim_background_job('phase1-worker', array['cv_analysis']);
  assert claimed.subject_id = '00000000-0000-4000-8000-0000000007d1', 'S5: the older job is claimed first';
  assert claimed.payload ? 'file_url', 'S5: the worker receives the link';
  select * into settled from private.settle_background_job(claimed.id, 'phase1-worker', false, null, 'TypeError', true);
  assert settled.status = 'queued' and settled.payload ? 'file_url', 'S5: a job waiting to retry keeps its link';
  assert settled.last_error = 'TypeError', 'S5: the error keeps its class';
end $$;
reset role;
do $$ begin
  update public.background_jobs set run_after = now() - interval '1 second' where subject_id = '00000000-0000-4000-8000-0000000007d1';
end $$;
set local role midan_worker;
do $$ declare claimed record; settled record; begin
  select * into claimed from private.claim_background_job('phase1-worker', array['cv_analysis']);
  select * into settled from private.settle_background_job(claimed.id, 'phase1-worker', false, null, 'file_unavailable', false);
  assert settled.status = 'failed', 'S5: a permanent failure is final';
  assert not settled.payload ? 'file_url', 'S5: a failed job keeps no link';
  assert settled.last_error = 'file_unavailable', 'S5: the short code is kept';
end $$;
reset role;

-- A worker that dies keeps the job's link only while attempts remain.
do $$ begin
  update public.background_jobs set created_at = now() - interval '2 hours', run_after = now() - interval '1 second', max_attempts = 2 where subject_id = '00000000-0000-4000-8000-0000000007d2';
end $$;
set local role midan_worker;
select id as crash_claimed from private.claim_background_job('dying-worker', array['cv_analysis']) \gset
reset role;
do $$ declare j record; begin
  update public.background_jobs set locked_at = now() - interval '1 hour' where subject_id = '00000000-0000-4000-8000-0000000007d2';
end $$;
set local role midan_worker;
select id as crash_claimed2 from private.claim_background_job('dying-worker', array['cv_analysis'], interval '5 minutes') \gset
reset role;
do $$ declare j public.background_jobs; begin
  select * into j from public.background_jobs where subject_id = '00000000-0000-4000-8000-0000000007d2';
  assert j.status = 'running' and j.attempts = 2 and j.payload ? 'file_url', 'S5: a reclaimed job with attempts left keeps its link';
  update public.background_jobs set locked_at = now() - interval '1 hour' where id = j.id;
end $$;
set local role midan_worker;
select count(*) as nothing_left from private.claim_background_job('dying-worker', array['nothing'], interval '5 minutes') \gset
reset role;
do $$ declare j public.background_jobs; a public.cv_analyses; begin
  select * into j from public.background_jobs where subject_id = '00000000-0000-4000-8000-0000000007d2';
  assert j.status = 'failed' and not j.payload ? 'file_url', 'S5: a job whose worker died on its last attempt ends, without its link';
  select * into a from public.cv_analyses where id = '00000000-0000-4000-8000-0000000007d2';
  assert a.status = 'failed' and a.failure_code = 'analysis_unavailable', 'S5: the candidate sees a failure, not a spinner';
  assert not exists (select 1 from public.background_jobs where status in ('succeeded', 'failed') and payload ? 'file_url'), 'S5: no finished job keeps a link';
  assert not exists (select 1 from public.background_jobs where coalesce(last_error, '') ~ 'token=|object/sign'), 'S5: no error holds a link';
  assert not exists (select 1 from public.audit_logs where details::text ~ 'token=|object/sign'), 'S5: the audit log holds no link';
end $$;

-- An administrator's retry can't bring the link back, and says so instead of reporting a success that did nothing.
insert into private.platform_admins (user_id) values ('00000000-0000-4000-8000-00000000a001') on conflict do nothing;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ declare failed uuid := (select id from public.background_jobs where subject_id = '00000000-0000-4000-8000-0000000007d1'); begin
  begin
    perform public.admin_retry_background_job(failed);
    assert false, 'S5: a CV job cannot be retried by an administrator';
  exception when check_violation then null;
  end;
end $$;
reset role;

\echo 'S2: hired is final for outcomes too'
do $$ declare app uuid; begin
  select id into app from public.applications where status = 'hired' limit 1;
  assert app is not null, 'S2: the checks above left a hired application';
  perform set_config('phase1.hired', app::text, true);
end $$;
do $$ declare o uuid; a record; begin
  select id, org_id, candidate_id, status into a from public.applications where id = current_setting('phase1.hired')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.organization_members where org_id = a.org_id and role = 'owner' limit 1), 'role', 'authenticated')::text, true);
  begin
    insert into public.hiring_outcomes (application_id, org_id, candidate_id, outcome) values (a.id, a.org_id, a.candidate_id, 'not_selected');
    assert false, 'S2: an outcome cannot undo a hire';
  exception when check_violation then null;
  end;
  assert (select status from public.applications where id = a.id) = 'hired', 'S2: the application stays hired';
end $$;

\echo 'Owner decisions: reopening, hiring through an outcome, sharing a CV'
insert into public.jobs (id, org_id, slug, title_ar, title_en, status) values
  ('00000000-0000-4000-8000-0000000001a3', '00000000-0000-4000-8000-0000000000a0', 'phase1-job-a3', 'وظيفة أ3', 'Job A3', 'published');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c002", "role": "authenticated"}';
set local role authenticated;
insert into public.applications (id, job_id, candidate_id) values
  ('00000000-0000-4000-8000-0000000005a3', '00000000-0000-4000-8000-0000000001a3', '00000000-0000-4000-8000-00000000c002');
reset role;
do $$ begin
  perform set_config('phase1.app', '00000000-0000-4000-8000-0000000005a3', true);
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  perform public.set_application_status(current_setting('phase1.app')::uuid, 'rejected');
end $$;
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a003", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform public.set_application_status(current_setting('phase1.app')::uuid, 'under_review');
    assert false, 'Decisions: a recruiter cannot reopen a rejected application';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select status from public.applications where id = current_setting('phase1.app')::uuid) = 'rejected', 'Decisions: it stays rejected';
  assert not exists (select 1 from public.audit_logs where action = 'reopen' and entity_id = current_setting('phase1.app')), 'Decisions: nothing was reopened';
end $$;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  perform public.set_application_status(current_setting('phase1.app')::uuid, 'under_review');
  begin
    insert into public.hiring_outcomes (application_id, org_id, candidate_id, outcome)
    select id, org_id, candidate_id, 'hired' from public.applications where id = current_setting('phase1.app')::uuid;
    assert false, 'Decisions: an outcome cannot hire before the shortlist';
  exception when check_violation then null;
  end;
  assert (select status from public.applications where id = current_setting('phase1.app')::uuid) = 'under_review', 'Decisions: nothing shortlists it on the way';
  perform public.set_application_status(current_setting('phase1.app')::uuid, 'shortlisted');
  insert into public.hiring_outcomes (application_id, org_id, candidate_id, outcome)
  select id, org_id, candidate_id, 'not_selected' from public.applications where id = current_setting('phase1.app')::uuid;
  assert (select status from public.applications where id = current_setting('phase1.app')::uuid) = 'rejected', 'Decisions: other outcomes do not need a shortlist';
  perform public.set_application_status(current_setting('phase1.app')::uuid, 'shortlisted');
  insert into public.hiring_outcomes (application_id, org_id, candidate_id, outcome)
  select id, org_id, candidate_id, 'hired' from public.applications where id = current_setting('phase1.app')::uuid;
  assert (select status from public.applications where id = current_setting('phase1.app')::uuid) = 'hired', 'Decisions: a shortlisted application can be hired through an outcome';
end $$;
reset role;
do $$ declare l record; begin
  select * into l from public.audit_logs where action = 'reopen' and entity_id = current_setting('phase1.app') order by created_at limit 1;
  assert l.actor_id = '00000000-0000-4000-8000-00000000a001', 'Decisions: the audit record names who reopened it';
  assert l.org_id = '00000000-0000-4000-8000-0000000000a0' and l.details ->> 'from' = 'rejected', 'Decisions: and from what';
end $$;

insert into storage.objects (bucket_id, name) values
  ('candidate-documents', '00000000-0000-4000-8000-00000000c002/applications/00000000-0000-4000-8000-0000000001a3/shared.pdf');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c002') = '{}', 'Decisions: no CV before the candidate shares one';
  begin
    perform public.share_cv_with_application(current_setting('phase1.app')::uuid, '00000000-0000-4000-8000-00000000c002/applications/00000000-0000-4000-8000-0000000001a3/shared.pdf');
    assert false, 'Decisions: staff cannot share a candidate''s CV';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000c002", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  begin
    perform public.share_cv_with_application(current_setting('phase1.app')::uuid, '00000000-0000-4000-8000-00000000c002/cv-current.pdf');
    assert false, 'Decisions: only a copy kept for this job can be attached';
  exception when check_violation then null;
  end;
  perform public.share_cv_with_application(current_setting('phase1.app')::uuid, '00000000-0000-4000-8000-00000000c002/applications/00000000-0000-4000-8000-0000000001a3/shared.pdf');
  begin
    perform public.share_cv_with_application(current_setting('phase1.app')::uuid, '00000000-0000-4000-8000-00000000c002/applications/00000000-0000-4000-8000-0000000001a3/shared.pdf');
    assert false, 'Decisions: a shared copy cannot be replaced';
  exception when check_violation then null;
  end;
end $$;
reset role;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}';
set local role authenticated;
do $$ begin
  assert phase1_test.visible('00000000-0000-4000-8000-00000000c002') = array['applications/00000000-0000-4000-8000-0000000001a3/shared.pdf'], 'Decisions: the organization reads what was shared, not the current CV';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.audit_logs where action = 'share_cv' and entity_id = current_setting('phase1.app')), 'Decisions: sharing is audited';
end $$;

\echo 'All Phase 1 database checks passed.'
rollback;
