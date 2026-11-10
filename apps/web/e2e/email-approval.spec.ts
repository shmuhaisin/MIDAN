// Full email confirmation journey through real local Auth/SMTP/API and the browser callback.
// No hosted SMTP sends; the only created account and workspace are removed in finally.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { assertLocalStack } from './local-only';

const root = resolve(__dirname, '../../..');
assertLocalStack(root);
const env: Record<string, string | undefined> = {};
for (const file of ['.env', '.env.test.local']) {
  if (existsSync(resolve(root, file))) Object.assign(env, parseEnv(readFileSync(resolve(root, file), 'utf8')));
}

test('employer email reaches local SMTP, confirms in browser, then requires admin approval', async ({ page, browser }) => {
  const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${env.LOCAL_PG_PORT ?? 54323}/midan` });
  const email = `email-flow-${randomUUID()}@example.com`;
  const password = randomBytes(20).toString('hex');
  const base = env.NEXT_PUBLIC_SUPABASE_URL!;
  let userId: string | undefined;
  let orgId: string | undefined;
  let adminContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  await db.connect();
  try {
    // Borrow an existing supported identity without creating or altering registry rows.
    const registry = (await db.query(`select e.id from public.employer_registry e where not exists (
      select 1 from public.organizations o where o.employer_registry_id=e.id and o.is_test and not o.is_demo)
      order by e.id limit 1`)).rows[0]?.id as string | undefined;
    expect(registry, 'Needs a supported employer without a linked test workspace').toBeTruthy();
    await page.goto('/en/register?as=organization');
    await page.locator('select[name="registry_id"]').selectOption(registry!);
    await page.locator('input[name="display_name"]').fill('Email Journey Representative');
    await page.locator('input[name="job_title"]').fill('Recruiter');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.waitForURL('**/en/check-email?as=organization');
    userId = (await db.query('select id from auth.users where email=$1', [email])).rows[0]?.id;
    expect(userId).toBeTruthy();
    expect((await db.query('select email_confirmed_at from auth.users where id=$1', [userId])).rows[0].email_confirmed_at).toBeNull();

    let confirmationLink: string | undefined;
    await expect.poll(async () => {
      const mails = await (await fetch(`${base}/__mail?to=${encodeURIComponent(email)}`)).json() as { links: string[] }[];
      confirmationLink = mails[0]?.links.find((link) => new URL(link).pathname.endsWith('/verify'));
      return Boolean(confirmationLink);
    }, { message: 'Real local Auth must emit a confirmation email to the SMTP sink' }).toBe(true);
    // Visit once in the browser. Fetching this link first would consume its one-time token.
    expect(new URL(confirmationLink!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    await page.goto(confirmationLink!);
    await page.waitForURL('**/en/organization/new');
    await expect(page.getByRole('heading', { name: 'Awaiting MIDAN administrator approval', exact: true })).toBeVisible();
    expect((await db.query('select email_confirmed_at from auth.users where id=$1', [userId])).rows[0].email_confirmed_at).not.toBeNull();
    expect((await db.query('select 1 from public.organization_members where user_id=$1', [userId])).rowCount).toBe(0);
    expect((await db.query('select status from public.employer_access_requests where user_id=$1', [userId])).rows[0].status).toBe('pending_approval');

    // A consumed one-time link fails, even though the existing verified session remains valid.
    // This reproduces token reuse, without assuming that a Cloud mail scanner consumed the owner's link.
    await page.goto(confirmationLink!);
    await expect(page.getByRole('heading', { name: "We couldn't confirm your email", exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your email is confirmed', exact: true })).toHaveCount(0);
    await page.goto('/en/organization/new');
    await expect(page.getByRole('heading', { name: 'Awaiting MIDAN administrator approval', exact: true })).toBeVisible();
    expect((await db.query('select 1 from public.organization_members where user_id=$1', [userId])).rowCount).toBe(0);

    const signIn = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.TEST_PLATFORM_ADMIN_EMAIL, password: env.TEST_PLATFORM_ADMIN_PASSWORD }),
    });
    expect(signIn.ok).toBe(true);
    const admin = await signIn.json() as { access_token: string; refresh_token: string };
    adminContext = await browser.newContext();
    const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
    await adminContext.addCookies([{ ...cookie, name: 'midan_at', value: admin.access_token }, { ...cookie, name: 'midan_rt', value: admin.refresh_token }]);
    const adminPage = await adminContext.newPage();
    await adminPage.goto('http://localhost:3100/en/admin/access');
    await adminPage.locator('li').filter({ hasText: email }).getByRole('button', { name: 'Approve access', exact: true }).click();
    await expect.poll(async () => {
      orgId = (await db.query(`select org_id from public.employer_access_requests where user_id=$1 and status='approved'`, [userId])).rows[0]?.org_id;
      return Boolean(orgId);
    }).toBe(true);
    expect((await db.query('select 1 from public.organization_members where user_id=$1 and org_id=$2', [userId, orgId])).rowCount).toBe(1);
    await page.goto('/en/organization/new');
    await page.waitForURL(`**/en/organization/${orgId}`);
  } finally {
    await adminContext?.close();
    // Find the account even if registration failed between creating it and assigning userId.
    userId ??= (await db.query('select id from auth.users where email=$1', [email])).rows[0]?.id;
    if (userId) {
      orgId ??= (await db.query(`select org_id from public.employer_access_requests where user_id=$1`, [userId])).rows[0]?.org_id;
      if (orgId) await db.query('delete from public.organizations where id=$1 and is_test', [orgId]);
      await db.query('delete from auth.users where id=$1', [userId]);
    }
    await db.end();
  }
});
