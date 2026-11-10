-- Rollback of 20261113090000_company_journey_rules.sql. Website and company type values it filled stay (they are the
-- registry's own values and the employer may have kept them); everything else it added is removed.
drop function if exists public.organization_business_domain(uuid);
drop trigger if exists fill_registry_identity on public.organizations;
drop function if exists private.fill_registry_identity();
drop function if exists private.registry_company_type(text);
drop trigger if exists assign_late_published_assessment on public.assessment_versions;
drop function if exists private.assign_late_published_assessment();
drop trigger if exists guard_job_publication_assessment on public.jobs;
drop function if exists private.guard_job_publication_assessment();
