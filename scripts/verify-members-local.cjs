// Local-only verification. No repository .env, real accounts, or remote DB access.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');
const statusFile = process.env.MIDAN_MEMBERS_LOCAL_STATUS_FILE;
if (!statusFile)
    throw Error('Set MIDAN_MEMBERS_LOCAL_STATUS_FILE for a dedicated isolated local stack; repository .env is never read');
const artifacts = path.dirname(path.resolve(statusFile));
const config = fs.readFileSync(path.join(artifacts, 'supabase/config.toml'), 'utf8');
if (!/^project_id\s*=\s*"MIDAN_members_integration"\s*$/m.test(config))
    throw Error('Refusing a stack not named MIDAN_members_integration');
const req = createRequire(path.join(root, 'apps/api/package.json'));
const { Client } = req('pg');
const { Test } = req('@nestjs/testing');
const { AppModule } = req('./dist/app.module.js');
const { DbService } = req('./dist/db/db.service.js');
const { configureApp } = req('./dist/common/configure-app.js');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('playwright');
const { spawn } = require('child_process');
const net = require('node:net');
let app, prisma, pg, web, browser;
const run = crypto.randomBytes(5).toString('hex');
const password = crypto.randomBytes(24).toString('base64url');
const say = message => console.log(message);
const local = url => { const u = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    throw Error('Refusing non-loopback destination'); return u; };
async function json(url, options = {}) { local(url); const r = await fetch(url, options); const data = await r.json(); if (!r.ok)
    throw Error(`Local request failed: ${new URL(url).pathname} HTTP ${r.status}`); return data; }
async function waitURL(url) { for (let n = 0; n < 100; n++) {
    try {
        const r = await fetch(url);
        if (r.ok)
            return;
    }
    catch { }
    await new Promise(r => setTimeout(r, 500));
} throw Error('Local server readiness timed out'); }
async function mailFor(email, kind) { for (let n = 0; n < 60; n++) {
    const list = await json('http://127.0.0.1:54324/api/v1/messages');
    const summary = (list.messages || []).find(m => m.To?.some(t => t.Address === email));
    if (summary) {
        const message = await json(`http://127.0.0.1:54324/api/v1/message/${summary.ID}`);
        const content = (message.Text || '') + (message.HTML || '');
        if (!kind || content.includes(kind))
            return message;
    }
    await new Promise(r => setTimeout(r, 500));
} throw Error('Local capture did not receive expected email'); }
async function ensureFreePort(port) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', () => reject(Error(`Local test port ${port} is occupied; refusing to reuse another server`)));
        probe.listen(port, '127.0.0.1', resolve);
    });
    await new Promise(resolve => probe.close(resolve));
}
async function main() {
    await ensureFreePort(3300);
    await ensureFreePort(3400);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    const api = local(status.API_URL || status.api_url || 'http://127.0.0.1:54321').origin;
    const anon = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
    if (!anon)
        throw Error('Local Auth public key missing');
    const adminUrl = status.DB_URL || status.db_url;
    if (!adminUrl) throw Error('Local status must include DB_URL');
    local(adminUrl);
    pg = new Client({ connectionString: adminUrl });
    pg.on('error', () => { });
    await pg.connect();
    const accessCode = crypto.randomBytes(24).toString('base64url');
    process.env.DEV_TEST_ACCESS_CODE = accessCode;
    await pg.query("insert into private.signup_access(code_hash,note) values(encode(sha256(convert_to($1,'UTF8')),'hex'),'isolated members verification')", [accessCode]);
    const dbPassword = crypto.randomBytes(24).toString('base64url');
    // Random URL-safe local credential; never printed or saved in tracked files.
    await pg.query(`alter role midan_api login password '${dbPassword}'`);
    const restricted = new URL(adminUrl);
    restricted.username = 'midan_api';
    restricted.password = dbPassword;
    process.env.NEXT_PUBLIC_SUPABASE_URL = api;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = anon;
    process.env.APP_URL = 'http://127.0.0.1:3300';
    process.env.INVITATION_TOKEN_SECRET = crypto.randomBytes(48).toString('base64url');
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', SMTP_SECURE: 'false', SMTP_FROM: 'MIDAN local <local@example.com>' });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.DATABASE_URL = restricted.href;
    process.env.DIRECT_URL = restricted.href;
    if (process.env.MIDAN_MEMBERS_PRISMA_CLIENT) {
        const { PrismaClient } = require(process.env.MIDAN_MEMBERS_PRISMA_CLIENT);
        const { PrismaPg } = require(process.env.MIDAN_MEMBERS_PRISMA_ADAPTER);
        prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: restricted.href }) });
    }
    else
        prisma = new DbService();
    prisma.withRetry = DbService.prototype.withRetry;
    // JS-driver errors differ from the application's native Prisma error classes.
    // Preserve the actual Postgres SQLSTATE/message while bridging only this test runtime.
    const { Prisma } = req('@prisma/client');
    const normalize = error => { const cause = error.cause ?? error.meta?.driverAdapterError?.cause; if (cause?.originalCode)
        throw new Prisma.PrismaClientUnknownRequestError(`${cause.originalCode}: ${cause.originalMessage}`, { clientVersion: '6.19.3' }); throw error; };
    prisma.asUser = function (user, fn) { return DbService.prototype.asUser.call(this, user, fn).catch(normalize); };
    prisma.asAnon = function (fn) { return DbService.prototype.asAnon.call(this, fn).catch(normalize); };
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DbService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    configureApp(app);
    await app.listen(3400, '127.0.0.1');
    async function signup(kind) {
        const email = `midan.local.${kind}.${run}@example.com`;
        await json(`${api}/auth/v1/signup?redirect_to=http%3A%2F%2Flocalhost%3A3100%2Fen%2Fauth%2Fconfirmed`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, data: { account_type: kind === 'owner' ? 'organization' : 'candidate', display_name: `Local ${kind}`, org_name_ar: 'منشأة اختبار محلية', org_name_en: `Local members test ${run}`, midan_test_access: accessCode } }) });
        const mail = await mailFor(email, '/auth/v1/verify');
        const text = (mail.Text || '') + ' ' + (mail.HTML || '');
        const match = text.match(/https?:\/\/[^\s"<>]*\/auth\/v1\/verify\?[^\s"<>]+/);
        if (!match)
            throw Error('Confirmation email has no local verification link');
        const link = match[0].replaceAll('&amp;', '&');
        local(link);
        const r = await fetch(link, { redirect: 'manual' });
        assert.ok(r.status >= 300 && r.status < 400, 'Auth confirmation redirect');
        const session = await json(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
        assert.ok(session.user.email_confirmed_at);
        return { email, ...session };
    }
    const owner = await signup('owner');
    say('PASS: local signup → captured confirmation email → verified owner login');
    const me = await json('http://127.0.0.1:3400/v1/me', { headers: { authorization: `Bearer ${owner.access_token}` } });
    assert.equal(me.organization_members.length, 1);
    const org = me.organization_members[0].org_id;
    const invitedEmail = `midan.local.invited.${run}@example.com`;
    const webLog = fs.openSync(path.join(artifacts, 'web.log'), 'a', 0o600);
    web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '-p', '3300'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, API_URL: 'http://127.0.0.1:3400', MIDAN_DIST_DIR: '.next-members', DEV_TEST_SIGNUP: 'false' }, stdio: ['ignore', webLog, webLog] });
    await waitURL('http://127.0.0.1:3300/en/invitations/accept');
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
    async function pageFor(session) { const c = await browser.newContext(); await c.addCookies([{ name: 'midan_at', value: session.access_token, url: 'http://127.0.0.1:3300', httpOnly: true, sameSite: 'Lax' }]); return c.newPage(); }
    const ownerPage = await pageFor(owner);
    await ownerPage.goto(`http://127.0.0.1:3300/en/organization/${org}/members`);
    await ownerPage.getByLabel('Email', { exact: true }).fill(invitedEmail);
    await ownerPage.getByRole('button', { name: 'Create invitation and send email' }).click();
    await ownerPage.getByText('The email server accepted the invitation message.').waitFor({ timeout: 30000 });
    const invitationMail = await mailFor(invitedEmail);
    const invitationText = (invitationMail.Text || '') + ' ' + (invitationMail.HTML || '');
    const invitationLink = invitationText.match(/http:\/\/127\.0\.0\.1:3300\/ar\/invitations\/accept#[\w-]{43}/)?.[0];
    assert.ok(invitationLink, 'Captured invitation link');
    assert.ok(invitationText.includes('Accept Invitation'));
    assert.ok(invitationText.includes('recruiter'));
    say('PASS: real members UI → Nest API → restricted Prisma/Postgres → SMTP capture');
    const invited = await signup('invited');
    const invitedPage = await pageFor(invited);
    await invitedPage.goto(invitationLink.replace('/ar/', '/en/'));
    await invitedPage.getByRole('button', { name: 'Accept Invitation', exact: true }).click();
    await invitedPage.waitForURL(`**/organization/${org}/members`, { timeout: 30000 });
    const result = await pg.query('select role from public.organization_members where org_id=$1 and user_id=$2', [org, invited.user.id]);
    assert.equal(result.rows[0].role, 'recruiter');
    const accepted = await pg.query('select accepted_at from public.organization_invitations where org_id=$1 and email=$2', [org, invitedEmail]);
    assert.ok(accepted.rows[0].accepted_at);
    say('PASS: verified invitee → real acceptance UI/API → membership + accepted_at');
    const member = ownerPage.getByRole('listitem').filter({ hasText: invitedEmail }).filter({ has: ownerPage.getByRole('combobox') });
    await ownerPage.reload();
    await member.getByRole('combobox').selectOption('reviewer');
    await member.getByRole('button', { name: 'Save role', exact: true }).click();
    await member.getByRole('status').waitFor();
    const changed = await pg.query('select role from public.organization_members where org_id=$1 and user_id=$2', [org, invited.user.id]);
    assert.equal(changed.rows[0].role, 'reviewer');
    say('PASS: owner changes invited member role through real UI/API');
    const invs = await json(`http://127.0.0.1:3400/v1/organizations/${org}/invitations`, { headers: { authorization: `Bearer ${owner.access_token}` } });
    assert.equal(invs[0].status, 'accepted');
    assert.equal(new Date(invs[0].expires_at) - new Date(invs[0].created_at), 7 * 86400000);
    say('PASS: accepted status and fixed seven-day expiry verified in real API');
    const protectedDelete = await fetch(`http://127.0.0.1:3400/v1/organizations/${org}/members/${(await json(`http://127.0.0.1:3400/v1/organizations/${org}/members`, { headers: { authorization: `Bearer ${owner.access_token}` } })).find(m => m.user_id === owner.user.id).id}`, { method: 'DELETE', headers: { authorization: `Bearer ${owner.access_token}` } });
    assert.equal(protectedDelete.status, 422, 'Last-owner deletion must be rejected');
    say('PASS: real API rejects removal of last owner');
    const replay = await fetch('http://127.0.0.1:3400/v1/invitations/accept', { method: 'POST', headers: { authorization: `Bearer ${invited.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ token: invitationLink.split('#')[1] }) });
    assert.equal(replay.status, 403, 'Accepted token cannot be replayed');
    const cancelEmail = `midan.local.cancel.${run}@example.com`;
    await ownerPage.getByLabel('Email', { exact: true }).fill(cancelEmail);
    await ownerPage.getByRole('button', { name: 'Create invitation and send email' }).click();
    await ownerPage.getByText('The email server accepted the invitation message.').waitFor();
    const cancelRow = ownerPage.getByRole('listitem').filter({ hasText: cancelEmail });
    ownerPage.once('dialog', d => d.accept());
    await cancelRow.getByRole('button', { name: 'Cancel invitation', exact: true }).click();
    await cancelRow.waitFor({ state: 'detached' });
    const cancelled = await pg.query('select id from public.organization_invitations where org_id=$1 and email=$2', [org, cancelEmail]);
    assert.equal(cancelled.rowCount, 0);
    say('PASS: real UI cancels invitation and removes its database row');
    ownerPage.once('dialog', d => d.accept());
    await member.getByRole('button', { name: 'Remove member', exact: true }).click();
    await member.waitFor({ state: 'detached' });
    const removed = await pg.query('select id from public.organization_members where org_id=$1 and user_id=$2', [org, invited.user.id]);
    assert.equal(removed.rowCount, 0);
    const denied = await fetch(`http://127.0.0.1:3400/v1/organizations/${org}/members`, { headers: { authorization: `Bearer ${invited.access_token}` } });
    assert.equal(denied.status, 403);
    say('PASS: real UI removes member; former member cannot access organization');
    const forged = await fetch(`${api}/rest/v1/organization_invitations`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${owner.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ org_id: org, email: `forged.${run}@example.com`, role: 'reviewer', token_hash: crypto.randomBytes(32).toString('hex'), expires_at: new Date(Date.now()+7*86400000).toISOString(), accepted_at: new Date().toISOString() }) });
    assert.equal(forged.status,400); assert.equal((await forged.json()).code,'23514');
    say('PASS: direct Supabase authenticated INSERT cannot pre-accept an invitation');
    const messages=JSON.parse(fs.readFileSync(path.join(root,'apps/web/src/messages/en.json'),'utf8'));
    async function invitedRegistration(kind, expireBeforeConfirmation=false) {
        const email=`midan.local.${kind}.${run}@example.com`;
        await json(`http://127.0.0.1:3400/v1/organizations/${org}/invitations`,{method:'POST',headers:{authorization:`Bearer ${owner.access_token}`,'content-type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),email,role:'reviewer'})});
        const invitationMessage=await mailFor(email,'/invitations/accept#');
        const text=(invitationMessage.Text||'')+' '+(invitationMessage.HTML||'');
        const invite=text.match(/http:\/\/127\.0\.0\.1:3300\/ar\/invitations\/accept#[\w-]{43}/)?.[0];assert.ok(invite);
        const context=await browser.newContext();const page=await context.newPage();
        const observedURLs=[];page.on('request',r=>observedURLs.push(r.url()));
        await page.goto(invite.replace('/ar/','/en/'));
        await page.getByRole('link',{name:messages.members.register,exact:true}).click();
        assert.equal(await page.locator('input[name="org_name_ar"]').count(),0);
        assert.equal(await page.locator('input[name="org_name_en"]').count(),0);
        await page.locator('input[name="display_name"]').fill('Local staff invitee');
        await page.locator('input[name="email"]').fill(email);
        await page.locator('input[name="password"]').fill(password);
        await page.getByRole('button',{name:messages.auth.registerSubmit,exact:true}).click();
        await page.waitForURL('**/check-email**',{timeout:30000});
        const confirmationMessage=await mailFor(email,'/auth/v1/verify');
        const contents=(confirmationMessage.Text||'')+' '+(confirmationMessage.HTML||'');
        const verify=contents.match(/https?:\/\/[^\s"<>]*\/auth\/v1\/verify\?[^\s"<>]+/)?.[0]?.replaceAll('&amp;','&');assert.ok(verify);local(verify);
        if(expireBeforeConfirmation)await pg.query("update public.organization_invitations set expires_at=now()-interval '1 second' where org_id=$1 and email=$2",[org,email]);
        const response=await fetch(verify,{redirect:'manual'});assert.ok(response.status>=300&&response.status<400);
        const target=response.headers.get('location');assert.ok(target);assert.equal(local(target).origin,'http://127.0.0.1:3300');
        const tab=await context.newPage();await tab.goto(target);
        if(expireBeforeConfirmation){
            await tab.getByText(messages.errors.invitation_unavailable,{exact:true}).waitFor();
            assert.equal((await context.cookies()).some(c=>c.name==='midan_invitation'),false);
            assert.equal((await context.cookies()).some(c=>c.name==='midan_at'),false);
            const membership=await pg.query('select m.id from public.organization_members m join public.users u on u.id=m.user_id where m.org_id=$1 and u.email=$2',[org,email]);assert.equal(membership.rowCount,0);
            say('PASS: expiry between registration and real email confirmation clears context and creates no membership');
        }else{
            await tab.waitForURL('**/en/invitations/accept',{timeout:30000});
            await tab.getByRole('button',{name:messages.members.accept,exact:true}).waitFor();
            const {rows:[user]}=await pg.query('select id,raw_user_meta_data from auth.users where email=$1',[email]);
            assert.equal(user.raw_user_meta_data.invitation_signup,true);assert.equal(user.raw_user_meta_data.org_name_ar,undefined);assert.equal(user.raw_user_meta_data.org_name_en,undefined);
            const owned=await pg.query("select id from public.organization_members where user_id=$1 and role='owner'",[user.id]);assert.equal(owned.rowCount,0);
            const cookie=(await context.cookies()).find(c=>c.name==='midan_invitation');assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Lax');
            await tab.getByRole('button',{name:messages.members.accept,exact:true}).click();await tab.waitForURL(`**/organization/${org}/members`);
            const membership=await pg.query('select role from public.organization_members where org_id=$1 and user_id=$2',[org,user.id]);assert.equal(membership.rows[0].role,'reviewer');
            assert.equal((await context.cookies()).some(c=>c.name==='midan_invitation'),false);
            assert.equal(await tab.evaluate(()=>sessionStorage.getItem('midan_pending_invitation')),null);
            assert.ok(observedURLs.every(url=>!url.includes(invite.split('#')[1])));
            say('PASS: new invitee registers through real UI, confirms in a new tab, returns automatically and joins without a new organization');
        }
        await context.close();return {verify};
    }
    const registration=await invitedRegistration('newstaff');
    await invitedRegistration('expiredstaff',true);
    const failureEmail=`midan.local.failedconfirmation.${run}@example.com`;
    await json(`http://127.0.0.1:3400/v1/organizations/${org}/invitations`,{method:'POST',headers:{authorization:`Bearer ${owner.access_token}`,'content-type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),email:failureEmail,role:'reviewer'})});
    const failureMail=await mailFor(failureEmail,'/invitations/accept#');const failureText=(failureMail.Text||'')+' '+(failureMail.HTML||'');const failureInvite=failureText.match(/http:\/\/127\.0\.0\.1:3300\/ar\/invitations\/accept#[\w-]{43}/)?.[0];assert.ok(failureInvite);
    const failureContext=await browser.newContext();const failurePage=await failureContext.newPage();await failurePage.goto(failureInvite.replace('/ar/','/en/'));await failurePage.getByRole('link',{name:messages.members.register,exact:true}).waitFor();
    // Reusing an actual consumed Auth verification link yields a real Auth failure.
    const failedResponse=await fetch(registration.verify,{redirect:'manual'});const failedTarget=failedResponse.headers.get('location');assert.ok(failedTarget);assert.equal(local(failedTarget).origin,'http://127.0.0.1:3300');await failurePage.goto(failedTarget);
    await failurePage.getByRole('heading',{name:messages.auth.confirmFailedTitle,exact:true}).waitFor();
    assert.equal((await failureContext.cookies()).some(c=>c.name==='midan_at'),false);assert.equal((await failureContext.cookies()).some(c=>c.name==='midan_invitation'),true);assert.ok(!failurePage.url().includes('#'));
    say('PASS: real Auth confirmation failure preserves retry context without logging in or accepting');
    await failurePage.goto('http://127.0.0.1:3300/en/invitations/accept#invalid');await failurePage.getByText(messages.errors.invitation_unavailable,{exact:true}).waitFor();assert.equal((await failureContext.cookies()).some(c=>c.name==='midan_invitation'),false);
    say('PASS: invalid replacement link clears the previous browser context');await failureContext.close();

}
main().catch(e => { console.error('LOCAL VERIFICATION FAILED:', String(e.message).replace(/eyJ[\w.-]+/g, '[redacted]').replace(/#[\w-]{43}/g, '#[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL]')); process.exitCode = 1; }).finally(async () => { if (browser)
    await browser.close(); if (web)
    web.kill(); if (app)
    await app.close(); if (prisma)
    await prisma.$disconnect(); if (pg)
    await pg.end(); });
