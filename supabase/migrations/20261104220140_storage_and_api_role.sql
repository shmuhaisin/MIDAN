-- Storage. Candidate files are private and reached through short-lived signed URLs.
-- Paths: candidate-documents/{user_id}/..., assessment-evidence/{org_id}/{attempt_id}/...,
-- organization-assets/{org_id}/...

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('candidate-documents', 'candidate-documents', false, 10485760,
    array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('assessment-evidence', 'assessment-evidence', false, 26214400,
    array['application/pdf', 'text/csv', 'text/plain', 'image/png', 'image/jpeg',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('organization-assets', 'organization-assets', true, 2097152,
    array['image/png', 'image/jpeg', 'image/webp']);

-- Text arguments: these receive path segments, which may not be valid UUIDs.
create function private.can_view_candidate_path(p_candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id
    where a.candidate_id::text = p_candidate and m.user_id = auth.uid()
  )
$$;

create function private.can_upload_evidence(p_org text, p_attempt text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessment_attempts t
    where t.id::text = p_attempt and t.org_id::text = p_org
      and t.candidate_id = auth.uid() and t.status = 'in_progress'
  )
$$;

create function private.can_read_evidence(p_org text, p_attempt text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessment_attempts t
    where t.id::text = p_attempt and t.org_id::text = p_org and (
      t.candidate_id = auth.uid()
      or (t.status = 'submitted' and exists (
        select 1 from public.organization_members m where m.org_id = t.org_id and m.user_id = auth.uid()
      ))
    )
  )
$$;

create function private.is_org_admin_path(p_org text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id::text = p_org and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  )
$$;

revoke all on function private.can_view_candidate_path(text), private.can_upload_evidence(text, text),
  private.can_read_evidence(text, text), private.is_org_admin_path(text) from public, anon;
grant execute on function private.can_view_candidate_path(text), private.can_upload_evidence(text, text),
  private.can_read_evidence(text, text), private.is_org_admin_path(text) to authenticated;

create policy "candidate manages own documents" on storage.objects for all to authenticated
  using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "org reads applicant documents" on storage.objects for select to authenticated
  using (bucket_id = 'candidate-documents' and private.can_view_candidate_path((storage.foldername(name))[1]));

create policy "candidate uploads evidence" on storage.objects for insert to authenticated
  with check (bucket_id = 'assessment-evidence'
    and private.can_upload_evidence((storage.foldername(name))[1], (storage.foldername(name))[2]));

create policy "authorized read evidence" on storage.objects for select to authenticated
  using (bucket_id = 'assessment-evidence'
    and private.can_read_evidence((storage.foldername(name))[1], (storage.foldername(name))[2]));

create policy "admins manage org assets" on storage.objects for all to authenticated
  using (bucket_id = 'organization-assets' and private.is_org_admin_path((storage.foldername(name))[1]))
  with check (bucket_id = 'organization-assets' and private.is_org_admin_path((storage.foldername(name))[1]));

-- The Core API's database login. It has no table access of its own: it must assume anon or
-- authenticated for each request, so RLS applies to everything the backend does.
-- It can't log in until a password is set outside version control (see docs/database/README.md).
create role midan_api nologin noinherit nobypassrls nocreatedb nocreaterole;
grant anon, authenticated to midan_api;
