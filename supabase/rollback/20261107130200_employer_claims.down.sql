-- Rolls back 20261107130200_employer_claims. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Claims and their evidence are lost. Links already approved stay on the organizations.
drop function public.submit_employer_claim(uuid, uuid, text, text, text);
drop function public.withdraw_employer_claim(uuid);
drop function public.admin_review_employer_claim(uuid, text, text);
drop policy "org admins upload claim evidence" on storage.objects;
drop policy "org admins read claim evidence" on storage.objects;
drop function private.can_manage_claim_file(text);
drop table public.employer_claims;
delete from storage.objects where bucket_id = 'employer-claims';
delete from storage.buckets where id = 'employer-claims';
