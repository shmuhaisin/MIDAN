-- Rolls back 20261107130000_job_search_and_listing_columns. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- This restores the wider public read of listings, so it's for emergencies.
drop function public.admin_listings(text);
revoke select on public.external_job_listings from anon, authenticated;
alter table public.jobs drop column search_text;
alter table public.job_requirements drop column search_text;
alter table public.external_job_listings drop column search_text;
grant select on public.external_job_listings to anon, authenticated;
