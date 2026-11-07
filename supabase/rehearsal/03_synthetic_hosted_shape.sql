-- LOCAL REHEARSAL ONLY, and entirely fictional. Gives the rehearsal the same shape as hosted on 2026-11-07 (7 accounts, 2
-- organizations, 2 jobs, 5,073 skills, 10 employers, 1 candidate with a CV), with no real value copied from it. Two applications
-- are added, which hosted doesn't have, so the migrations and rollbacks also meet those rows.
\set ON_ERROR_STOP on
insert into private.signup_access (code_hash, note)
select encode(sha256(convert_to('local-dev-access', 'UTF8')), 'hex'), 'Rehearsal';

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select ('00000000-0000-4000-9000-00000000000' || n)::uuid, 'rehearsal' || n || '@example.com',
  jsonb_build_object('midan_test_access', 'local-dev-access', 'display_name', 'Rehearsal ' || n, 'account_type', case when n in (1, 2) then 'organization' else 'candidate' end), now()
from generate_series(1, 7) n;

insert into public.organizations (id, slug, name_ar, name_en, is_demo) values
  ('00000000-0000-4000-9000-0000000000a1', 'rehearsal-org-a', 'جهة تجريبية أ', 'Rehearsal Org A', true),
  ('00000000-0000-4000-9000-0000000000a2', 'rehearsal-org-b', 'جهة تجريبية ب', 'Rehearsal Org B', true);
insert into public.organization_members (org_id, user_id, role) values
  ('00000000-0000-4000-9000-0000000000a1', '00000000-0000-4000-9000-000000000001', 'owner'),
  ('00000000-0000-4000-9000-0000000000a2', '00000000-0000-4000-9000-000000000002', 'owner');
insert into public.jobs (id, org_id, slug, title_ar, title_en, status, is_demo) values
  ('00000000-0000-4000-9000-0000000000b1', '00000000-0000-4000-9000-0000000000a1', 'rehearsal-job-a', 'وظيفة تجريبية أ', 'Rehearsal Job A', 'published', true),
  ('00000000-0000-4000-9000-0000000000b2', '00000000-0000-4000-9000-0000000000a2', 'rehearsal-job-b', 'وظيفة تجريبية ب', 'Rehearsal Job B', 'published', true);

insert into public.reference_skills (sector_code, skill_kind, name_ar, source_file, source_sheet, source_row)
select 'digital', 'technical', 'مهارة تجريبية ' || n, 'rehearsal.xlsx', 'rehearsal', n from generate_series(1, 5073) n;
insert into public.employer_registry (source_company_id, name_ar, name_en, verification_status, source_file)
select 'SYN-' || lpad(n::text, 3, '0'), 'جهة وهمية ' || n, 'Fictional Employer ' || n, 'pending_live_verification', 'rehearsal.xlsx' from generate_series(1, 10) n;

update public.candidate_profiles set full_name = 'Rehearsal Candidate', cv_path = user_id || '/cv-current.pdf' where user_id = '00000000-0000-4000-9000-000000000003';
insert into public.candidate_profiles (user_id, full_name, cv_path)
select '00000000-0000-4000-9000-000000000003', 'Rehearsal Candidate', '00000000-0000-4000-9000-000000000003/cv-current.pdf'
where not exists (select 1 from public.candidate_profiles where user_id = '00000000-0000-4000-9000-000000000003');
insert into public.cv_documents (candidate_id, storage_path, mime_type, size_bytes)
values ('00000000-0000-4000-9000-000000000003', '00000000-0000-4000-9000-000000000003/cv-current.pdf', 'application/pdf', 10);
insert into storage.objects (bucket_id, name) values
  ('candidate-documents', '00000000-0000-4000-9000-000000000003/cv-current.pdf'),
  ('candidate-documents', '00000000-0000-4000-9000-000000000003/applications/00000000-0000-4000-9000-0000000000b2/copy.pdf');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-9000-000000000003", "role": "authenticated"}';
insert into public.applications (id, job_id, candidate_id, cv_snapshot_path) values
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-0000000000b1', '00000000-0000-4000-9000-000000000003', null),
  ('00000000-0000-4000-9000-0000000000c2', '00000000-0000-4000-9000-0000000000b2', '00000000-0000-4000-9000-000000000003',
    '00000000-0000-4000-9000-000000000003/applications/00000000-0000-4000-9000-0000000000b2/copy.pdf');
