-- Removes what the end-to-end suite leaves behind. Touches only organizations named midan-test-*
-- and files uploaded by the midan.test.* accounts. Demo data and test accounts stay.
begin;
set local storage.allow_delete_query = 'true';
delete from storage.objects o using public.users u
  where o.owner_id = u.id::text and u.email like 'midan.test.%@example.com';
delete from public.organizations where slug like 'midan-test-%';
delete from public.candidate_skills s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.candidate_reference_skills s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.career_plan_items s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.career_targets s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.practice_tasks s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.cv_documents s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.notifications s using public.users u
  where s.user_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.candidate_profiles p using public.users u
  where p.user_id = u.id and u.email like 'midan.test.%@example.com';
-- Platform-level entries have no organization and stay.
delete from public.audit_logs l where l.org_id is not null and not exists (select 1 from public.organizations o where o.id = l.org_id);
-- Listings, imports and catalog entries created by the pipeline tests, which always carry these marks.
delete from public.external_job_listings where source_job_id like 'midan-test-%';
delete from storage.objects where bucket_id = 'employer-claims' and not exists (select 1 from public.organizations o where o.id::text = (storage.foldername(name))[1]);
delete from public.import_runs where started_by = 'e2e' or started_by like 'admin:midan.test.%';
delete from public.learning_resources where provider = 'Midan test provider';
delete from public.background_jobs j using public.users u where j.acting_user_id = u.id and u.email like 'midan.test.%@example.com';
commit;
