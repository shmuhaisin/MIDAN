-- The API runs queued work (CV analysis) as midan_worker: each claim switches to that role (apps/api/src/db/db.service.ts).
-- 20261106150000 lets the API's own login, midan_api, switch to it. On Supabase Cloud the API may log in as postgres,
-- which creates the role but can't switch to it (PostgreSQL 16+ gives the creator only ADMIN OPTION). This lets postgres
-- switch too. midan_worker stays nologin, noinherit and subject to RLS, so postgres gains no new access to data.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') and exists (select 1 from pg_roles where rolname = 'midan_worker')
     and not pg_has_role('postgres', 'midan_worker', 'SET') then
    grant midan_worker to postgres with inherit false, set true;
  end if;
end $$;
