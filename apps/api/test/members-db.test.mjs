// Explicit opt-in, loopback-only DB. Never loads .env or uses the team's fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
const url = new URL(process.env.MIDAN_MEMBERS_TEST_DATABASE_URL || 'invalid:');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/midan_members_test') throw new Error('Use an isolated loopback database named midan_members_test only');
const pool = new pg.Pool({ connectionString: url.href });
const root = new URL('../../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const a = randomUUID(), b = randomUUID(), invited = randomUUID(), wrong = randomUUID(), unverified = randomUUID(), fresh = randomUUID(), org = randomUUID(), other = randomUUID();
const hash = token => createHash('sha256').update(token).digest('hex');
async function actor(id, fn) {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id })]); const result = await fn(c); await c.query('commit'); return result; }
  catch(e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
async function invitation(token, email = 'invited@example.com', expires = '1 day') {
  const id = randomUUID();
  await pool.query(`insert into public.organization_invitations (id, org_id, email, role, token_hash, expires_at) values ($1,$2,$3,'recruiter',$4,now()+$5::interval)`,[id,org,email,hash(token),expires]); return id;
}
before(async()=>{
  // This harness deliberately owns only a dedicated disposable database.
  await pool.query(`drop schema public cascade; create schema public; drop schema if exists private cascade; drop schema if exists auth cascade;
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    grant usage on schema public to anon; grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await pool.query(read('supabase/migrations/20261104215752_core_schema.sql'));
  const functions = read('supabase/migrations/20261104220032_functions_and_triggers.sql');
  const helper = functions.slice(functions.indexOf('create function private.is_org_member'), functions.indexOf('-- An organization may see'));
  const guard = functions.slice(functions.indexOf('create function private.guard_last_owner'), functions.indexOf('-- Assessment versions:'));
  await pool.query(helper+guard);
  const policies=read('supabase/migrations/20261104220035_rls_and_grants.sql');
  await pool.query(`alter table public.organizations enable row level security;
    grant select, update(name_ar) on public.organizations to authenticated;
    create policy "members read" on public.organizations for select to authenticated using(private.is_org_member(id));
    create policy "admins update" on public.organizations for update to authenticated using(private.is_org_member(id,array['owner','admin']::public.org_role[]));
    alter table public.organization_members enable row level security; alter table public.organization_invitations enable row level security;
    grant usage on schema private to authenticated; grant execute on function private.is_org_member(uuid,public.org_role[]) to authenticated;
    grant select,insert,update,delete on public.organization_members, public.organization_invitations to authenticated;
    create policy "members read" on public.organization_members for select to authenticated using(private.is_org_member(org_id));`);
  await pool.query(policies.slice(policies.indexOf('create policy "admins insert"'),policies.indexOf('create policy "public reads" on public.organization_branding')));
  await pool.query(read('supabase/migrations/20261107090000_organization_members_and_invitations.sql'));
  for (const [id,email,confirmed] of [[a,'owner@example.com',true],[b,'other@example.com',true],[invited,'invited@example.com',true],[wrong,'wrong@example.com',true],[unverified,'unverified@example.com',false],[fresh,'fresh@example.com',true]]) {
    await pool.query('insert into auth.users values($1,$2,$3)',[id,email,confirmed?new Date():null]);
    await pool.query('insert into public.users(id,email,display_name) values($1,$2,$2)',[id,email]);
  }
  for(const [id,slug] of [[org,'one'],[other,'two']]) await pool.query("insert into public.organizations(id,slug,name_ar,name_en) values($1,$2,'منشأة',$2)",[id,slug]);
  await pool.query("insert into public.organization_members(org_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner')",[org,a,other,b]);
});
after(()=>pool.end());
test('projected member identity is available only inside the organization',async()=>{
  const rows=await actor(a,c=>c.query('select * from public.list_organization_members($1)',[org])); assert.equal(rows.rows[0].email,'owner@example.com');
  await assert.rejects(actor(b,c=>c.query('select * from public.list_organization_members($1)',[org])),{code:'42501'});
});
test('manager can take the organization lock using restricted table grants',async()=>{
  const rows=await actor(a,c=>c.query('select id from public.organizations where id=$1 for update',[org]));assert.equal(rows.rowCount,1);
});
test('members RLS does not reveal other tenant rows',async()=>{
  const rows=await actor(b,c=>c.query('select * from public.organization_members where org_id=$1',[org]));assert.equal(rows.rowCount,0);
});
test('only managers create invitations, and owner invitations are rejected',async()=>{
  await assert.rejects(actor(b,c=>c.query("insert into public.organization_invitations(org_id,email,role,token_hash,expires_at) values($1,'x@example.com','admin','other',now()+interval '7 days')",[org])),{code:'42501'});
  await assert.rejects(actor(a,c=>c.query("insert into public.organization_invitations(org_id,email,role,token_hash,expires_at) values($1,'x@example.com','owner','owner',now()+interval '7 days')",[org])),{code:'23514'});
});
test('wrong, unverified, expired, missing and cancelled invitations cannot be accepted',async()=>{
  await invitation('wrong'); await assert.rejects(actor(wrong,c=>c.query("select public.accept_organization_invitation('wrong')")),{code:'42501'});
  await invitation('unverified','unverified@example.com');await assert.rejects(actor(unverified,c=>c.query("select public.accept_organization_invitation('unverified')")),{code:'42501'});
  await invitation('expired','invited@example.com','-1 day');await assert.rejects(actor(invited,c=>c.query("select public.accept_organization_invitation('expired')")),{code:'42501'});
  const id=await invitation('cancelled');await actor(a,c=>c.query('delete from public.organization_invitations where id=$1',[id]));
  for(const token of ['cancelled','missing']) await assert.rejects(actor(invited,c=>c.query('select public.accept_organization_invitation($1)',[token])),{code:'42501'});
});
test('invitation expiring while waiting on organization lock is rejected',async()=>{
  const id=await invitation('expires-while-waiting','wrong@example.com','0.5 second');
  const {rows:[invitationRow]}=await pool.query('select expires_at from public.organization_invitations where id=$1',[id]);
  const blocker=await pool.connect();
  try {
    await blocker.query('begin');
    await blocker.query('select id from public.organizations where id=$1 for update',[org]);
    const rejected=assert.rejects(actor(wrong,async c=>{
      const {rows:[clock]}=await c.query('select now() as started_at');
      assert.ok(clock.started_at < invitationRow.expires_at,'Transaction must start before expiry to exercise the lock-wait regression');
      return c.query("select public.accept_organization_invitation('expires-while-waiting')");
    }),{code:'42501'});
    await new Promise(resolve=>setTimeout(resolve,800));
    await blocker.query('commit');
    await rejected;
  } finally {await blocker.query('rollback');blocker.release();}
  const rows=await pool.query('select id from public.organization_members where org_id=$1 and user_id=$2',[org,wrong]);assert.equal(rows.rowCount,0);
});
test('matching verified email accepts once, concurrent reuse fails, with no duplicate membership',async()=>{
  const id=await invitation('valid');const results=await Promise.allSettled([actor(invited,c=>c.query("select public.accept_organization_invitation('valid')")),actor(invited,c=>c.query("select public.accept_organization_invitation('valid')"))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const accepted=await pool.query('select accepted_at from public.organization_invitations where id=$1',[id]);assert.ok(accepted.rows[0].accepted_at);
  const rows=await pool.query('select role from public.organization_members where org_id=$1 and user_id=$2',[org,invited]);assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].role,'recruiter');
});
test('existing membership is never promoted by another invitation',async()=>{
  const id=await invitation('existing');await pool.query("update public.organization_invitations set role='admin' where id=$1",[id]);
  await assert.rejects(actor(invited,c=>c.query("select public.accept_organization_invitation('existing')")),{code:'23505'});
  const rows=await pool.query('select accepted_at from public.organization_invitations where id=$1',[id]);assert.equal(rows.rows[0].accepted_at,null);
});
test('ordinary member cannot promote themselves or manage invitations',async()=>{
  const r=await actor(invited,c=>c.query("update public.organization_members set role='owner' where user_id=$1",[invited]));assert.equal(r.rowCount,0);
  const inv=await actor(invited,c=>c.query('select * from public.organization_invitations'));assert.equal(inv.rowCount,0);
  await assert.rejects(actor(a,c=>c.query('update public.organization_invitations set accepted_at=now()')),{code:'42501'});
});
test('last owner cannot be deleted, demoted or moved to another organization',async()=>{
  for(const sql of ["delete from public.organization_members where user_id=$1", "update public.organization_members set role='admin' where user_id=$1", `update public.organization_members set org_id='${other}' where user_id=$1`]) await assert.rejects(actor(a,c=>c.query(sql,[a])),{code:'23514'});
});
test('admin cannot edit/remove owner or grant owner role',async()=>{
  await pool.query("update public.organization_members set role='admin' where user_id=$1",[invited]);
  await assert.rejects(actor(invited,c=>c.query("update public.organization_members set role='owner' where user_id=$1",[invited])),{code:'42501'});
  const result=await actor(invited,c=>c.query('delete from public.organization_members where user_id=$1',[a]));assert.equal(result.rowCount,0);
  await assert.rejects(actor(invited,c=>c.query("insert into public.organization_members(org_id,user_id,role) values($1,$2,'owner')",[org,wrong])),{code:'42501'});
});
test('concurrent owner removals keep one owner',async()=>{
  await pool.query("insert into public.organization_members(org_id,user_id,role) values($1,$2,'owner')",[org,wrong]);
  // Definer/admin harness isolates the trigger from caller-permission changes.
  const remove=async user=>{const c=await pool.connect();try{await c.query('begin');await c.query('delete from public.organization_members where org_id=$1 and user_id=$2',[org,user]);await c.query('commit');}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const results=await Promise.allSettled([remove(a),remove(wrong)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rows=await pool.query("select * from public.organization_members where org_id=$1 and role='owner'",[org]);assert.equal(rows.rowCount,1);
});

test('pre-accepted INSERT is rejected for managers and direct DB writes; approved acceptance still works',async()=>{
  const sql="insert into public.organization_invitations(org_id,email,role,token_hash,expires_at,accepted_at) values($1,'fresh@example.com','reviewer',$2,now()+interval '7 days',now())";
  const {rows:[owner]}=await pool.query("select user_id from public.organization_members where org_id=$1 and role='owner'",[org]);
  await assert.rejects(actor(owner.user_id,c=>c.query(sql,[org,hash('forged-manager')])),{code:'23514'});
  await assert.rejects(pool.query(sql,[org,hash('forged-direct')]),{code:'23514'});
  const id=await invitation('guard-valid','fresh@example.com');
  await actor(fresh,c=>c.query("select public.accept_organization_invitation('guard-valid')"));
  const accepted=await pool.query('select accepted_at from public.organization_invitations where id=$1',[id]);assert.ok(accepted.rows[0].accepted_at);
  const members=await pool.query('select role from public.organization_members where org_id=$1 and user_id=$2',[org,fresh]);assert.equal(members.rows[0].role,'recruiter');
});
test('anonymous token inspection exposes only expiry and rejects wrong email or unavailable tokens',async()=>{
  const id=await invitation('inspect-valid','fresh@example.com');
  const c=await pool.connect();try{
    await c.query('begin');await c.query('set local role anon');
    const result=await c.query("select public.inspect_organization_invitation('inspect-valid','fresh@example.com') as expires_at");assert.deepEqual(Object.keys(result.rows[0]),['expires_at']);assert.ok(result.rows[0].expires_at);
    await c.query('rollback');
    for(const [token,email] of [['inspect-valid','wrong@example.com'],['missing','fresh@example.com'],['expired','invited@example.com']]){
      await c.query('begin');await c.query('set local role anon');
      await assert.rejects(c.query('select public.inspect_organization_invitation($1,$2)',[token,email]),{code:'42501'});await c.query('rollback');
    }
  }finally{await c.query('rollback');c.release();}
  const row=await pool.query('select accepted_at from public.organization_invitations where id=$1',[id]);assert.equal(row.rows[0].accepted_at,null);
});
