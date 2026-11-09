-- Reverses 20261111090000_organization_verification. Documents in the organization-documents bucket are deleted with it.
drop policy if exists "only active organizations are listed" on public.jobs;
drop policy if exists "only active organizations are listed to others" on public.jobs;
drop function if exists private.has_applied_to(uuid);
drop trigger if exists guard_invitation_org on public.organization_invitations;
drop function if exists private.guard_invitation_org();
drop trigger if exists guard_applicant_org on public.applications;
drop function if exists private.guard_application_org();
drop trigger if exists guard_job_publication_org on public.jobs;
drop function if exists private.guard_job_publication_org();
drop function if exists public.admin_set_organization_suspension(uuid, boolean, text);
drop function if exists public.admin_decide_organization(uuid, text, text);
drop function if exists public.submit_organization_verification(uuid);
drop function if exists private.notify_org_admins(uuid, text, text);
drop table if exists public.organization_verification_requests;
drop policy if exists "org admins upload organization documents" on storage.objects;
drop policy if exists "org admins and platform admins read organization documents" on storage.objects;
drop policy if exists "org admins delete organization documents" on storage.objects;
drop function if exists private.can_manage_org_document(text);
drop table if exists public.organization_documents;
drop function if exists private.org_documents_editable(uuid);
delete from storage.objects where bucket_id = 'organization-documents';
delete from storage.buckets where id = 'organization-documents';
drop trigger if exists guard_organization_verification on public.organizations;
drop function if exists private.guard_organization_verification();
drop function if exists private.org_is_active(uuid);
delete from public.audit_logs where action = 'approved_before_review' and entity = 'organizations';
alter table public.organizations
  drop column if exists verification_status, drop column if exists verification_updated_at,
  drop column if exists commercial_registration, drop column if exists website, drop column if exists business_email,
  drop column if exists contact_phone, drop column if exists city, drop column if exists description_ar,
  drop column if exists description_en, drop column if exists representative_name, drop column if exists representative_title;
