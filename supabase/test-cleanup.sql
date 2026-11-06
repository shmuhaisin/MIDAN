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
delete from public.cv_documents s using public.users u
  where s.candidate_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.notifications s using public.users u
  where s.user_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.candidate_profiles p using public.users u
  where p.user_id = u.id and u.email like 'midan.test.%@example.com';
delete from public.audit_logs l where not exists (select 1 from public.organizations o where o.id = l.org_id);
commit;
