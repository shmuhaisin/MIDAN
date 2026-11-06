-- LOCAL DEVELOPMENT ONLY. Applied after Supabase Auth has migrated the auth schema.
-- Same definitions as Supabase: identity comes from the JWT claims set for the current transaction.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (auth.jwt() ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (auth.jwt() ->> 'role'))::text
$$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), (auth.jwt() ->> 'email'))::text
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;

