-- The unqualified id in the original policy resolved to jobs.id, so no organization ever matched.
drop policy "public reads hiring orgs" on public.organizations;
create policy "public reads hiring orgs" on public.organizations for select to anon, authenticated
  using (exists (select 1 from public.jobs j where j.org_id = organizations.id and j.status = 'published'));
