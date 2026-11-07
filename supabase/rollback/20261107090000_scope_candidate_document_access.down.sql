-- Rolls back 20261107090000_scope_candidate_document_access. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

drop policy "org reads applicant documents" on storage.objects;
drop function if exists private.can_view_candidate_document(text);
CREATE POLICY "org reads applicant documents" ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'candidate-documents'::text) AND private.can_view_candidate_path((storage.foldername(name))[1])));
