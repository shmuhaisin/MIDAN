// Local PostgreSQL only. All DDL and data changes are rolled back, including on assertion failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PORTS } from './local-ports.mjs';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORTS.pg}/midan` });
const root = new URL('../supabase/', import.meta.url);
const up = readFileSync(new URL('migrations/20261112090000_employer_access_requests.sql', root), 'utf8');
const down = readFileSync(new URL('rollback/20261112090000_employer_access_requests.down.sql', root), 'utf8');
async function snapshot() {
  return (await db.query(`select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
    'columns', (select jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attacl) order by c.relname,a.attnum)
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped),
    'tables', (select jsonb_agg(jsonb_build_array(c.relname,c.relacl,c.relrowsecurity) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
    'policies', (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
    'indexes', (select jsonb_agg(to_jsonb(i) order by tablename,indexname) from pg_indexes i where schemaname='public'),
    'memberships', (select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.organization_members m),
    'registry', (select jsonb_agg(to_jsonb(e) order by id) from public.employer_registry e)
  ) as state`)).rows[0].state;
}
await db.connect();
try {
  await db.query('begin');
  // Remove this unreleased migration only within our transaction to establish the 57-migration baseline.
  await db.query(down);
  assert.equal((await db.query(`select count(*)::int as n from pg_attribute a,
    lateral aclexplode(a.attacl) acl where a.attrelid='public.organization_members'::regclass
    and a.attname='role' and acl.grantee='authenticated'::regrole and acl.privilege_type='UPDATE'`)).rows[0].n, 0,
    'Rollback must remove the explicit UPDATE(role) grant, not hide it behind table privileges');
  const baseline = await snapshot();
  for (let cycle = 1; cycle <= 2; cycle++) {
    await db.query(up);
    const grants = (await db.query(`select has_column_privilege('authenticated','public.organization_members','role','UPDATE') as role,
      has_column_privilege('authenticated','public.organization_members','user_id','UPDATE') as identity,
      has_column_privilege('authenticated','public.organization_members','org_id','UPDATE') as tenant`)).rows[0];
    assert.deepEqual(grants, { role: true, identity: false, tenant: false });
    await db.query(down);
    assert.deepEqual(await snapshot(), baseline, 'Rollback must restore functions, column/table ACLs, policies, indexes, memberships and registry');
    console.log(`PASS migration/rollback cycle ${cycle}: schema privileges and existing records restored`);
  }
} finally {
  await db.query('rollback');
  await db.end();
}
