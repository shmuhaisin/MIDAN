-- An organization reads only the CV that was submitted to it: the copy kept with its own active application or, for an
-- application made without a copy, the candidate's current CV (the same fallback as GET /v1/applications/:id/cv-url).
-- Until now access covered every file in the candidate's folder, which included the copies attached to applications to
-- other organizations, and let the Storage list endpoint show which other jobs the candidate had applied to.
-- private.can_view_candidate_path stays: it still decides access to candidate rows, which aren't per application.

create function private.can_view_candidate_document(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id and m.user_id = auth.uid()
    where a.status <> 'withdrawn'
      and a.candidate_id::text = (storage.foldername(p_name))[1]
      and (a.cv_snapshot_path = p_name
        or (a.cv_snapshot_path is null
          and exists (select 1 from public.candidate_profiles p where p.user_id = a.candidate_id and p.cv_path = p_name)))
  )
$$;

revoke all on function private.can_view_candidate_document(text) from public, anon;
grant execute on function private.can_view_candidate_document(text) to authenticated;

drop policy "org reads applicant documents" on storage.objects;
create policy "org reads applicant documents" on storage.objects for select to authenticated
  using (bucket_id = 'candidate-documents' and private.can_view_candidate_document(name));
