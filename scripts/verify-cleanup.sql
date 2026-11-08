-- Removes what scripts/verify-*.mjs leave in the demo organization: the applications of the first test candidate, with
-- their attempts and evaluations (the demo's own candidate is the second one, and is untouched). Local database only.
begin;
create temp table verify_apps on commit drop as
  select a.id from public.applications a
  join public.users u on u.id = a.candidate_id and u.email = 'midan.test.candidate-one@example.com'
  join public.jobs j on j.id = a.job_id
  join public.organizations o on o.id = j.org_id and o.slug = 'midan-demo-oasis';
delete from public.evaluation_results r using public.assessment_attempts t
  where r.attempt_id = t.id and t.application_id in (select id from verify_apps);
delete from public.assessment_attempts where application_id in (select id from verify_apps);
delete from public.applications where id in (select id from verify_apps);
commit;
