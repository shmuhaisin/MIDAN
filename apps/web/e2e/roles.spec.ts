// Who sees what on a job, in Arabic and English: a candidate can apply once, an organization account can't apply and is
// kept out of candidate pages, a stale or unknown address shows the not-found page (never an error), and an ended session
// goes to sign-in. Against the running web app, API and local Supabase; fictional accounts. Leftovers are removed by
// supabase/test-cleanup.sql.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

const root = resolve(__dirname, '../../..');
const env: Record<string, string | undefined> = {};
for (const f of ['.env', '.env.test.local']) {
  if (existsSync(resolve(root, f))) Object.assign(env, parseEnv(readFileSync(resolve(root, f), 'utf8')));
}
const RUN = Date.now().toString(36);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function token(who: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

async function signedIn(browser: Browser, who: string): Promise<BrowserContext> {
  const { access_token, refresh_token } = await token(who);
  const context = await browser.newContext();
  const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
  await context.addCookies([{ ...cookie, name: 'midan_at', value: access_token }, { ...cookie, name: 'midan_rt', value: refresh_token }]);
  return context;
}

async function api(who: string, path: string, body?: unknown) {
  const { access_token } = await token(who);
  const res = await fetch(`${env.API_URL}/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  return res.json();
}

let org: string;
let job: string;

test.beforeAll(async () => {
  org = (await api('ORG_A_OWNER', '/organizations', { slug: `midan-test-roles-${RUN}`, name_ar: 'جهة الأدوار', name_en: 'Roles org' })).id;
  // A published job, created the way the wizard does now: titles and a description, no address.
  job = (await api('ORG_A_OWNER', `/organizations/${org}/jobs`, {
    title_ar: `محلل أدوار ${RUN}`, title_en: `Roles analyst ${RUN}`, status: 'published',
    description_ar: 'يحلل بيانات المبيعات الشهرية ويعرض النتائج على الإدارة.', description_en: 'Analyses monthly sales data and presents the findings to management.',
  })).id;
});

test('a candidate sees Apply in both languages, applies once, and then sees the application instead', async ({ browser }) => {
  // The candidate account needs its candidate profile, the way a person's account gets one.
  const { access_token } = await token('CANDIDATE_TWO');
  await fetch(`${env.API_URL}/v1/me/candidate-profile`, { method: 'PUT', headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ full_name: 'Test Candidate Two' }) });
  const page = await (await signedIn(browser, 'CANDIDATE_TWO')).newPage();

  await page.goto(`/ar/opportunities/${job}`);
  await expect(page.getByText('يحلل بيانات المبيعات الشهرية ويعرض النتائج على الإدارة.')).toBeVisible();
  await expect(page.locator(`a[href$="/opportunities/${job}/apply"]`).first()).toBeVisible();
  await expect(page.getByText('هذا حساب منشأة.')).toHaveCount(0);

  await page.goto(`/en/opportunities/${job}`);
  await expect(page.getByText('Analyses monthly sales data and presents the findings to management.')).toBeVisible();
  await page.getByRole('link', { name: 'Apply for this job' }).click();
  await page.getByRole('button', { name: 'Confirm application' }).click();
  await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}(\?new=1)?$/);
  const applicationUrl = new URL(page.url()).pathname;

  // Applying again isn't offered, and the apply page leads to the application already made.
  await page.goto(`/en/opportunities/${job}`);
  await expect(page.getByText('Your application was sent')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply for this job' })).toHaveCount(0);
  await page.goto(`/en/opportunities/${job}/apply`);
  await expect(page).toHaveURL(new RegExp(`${applicationUrl}(\\?.*)?$`));
  await page.goto('/ar/applications');
  await expect(page.getByText(`محلل أدوار ${RUN}`).first()).toBeVisible();

  // The organization sees the applicant.
  const applicants = await api('ORG_A_OWNER', `/organizations/${org}/applications`);
  expect(applicants).toHaveLength(1);
});

test('an organization account sees why it cannot apply, and is kept out of candidate pages', async ({ browser }) => {
  const page = await (await signedIn(browser, 'ORG_A_OWNER')).newPage();
  for (const [locale, note] of [['en', 'This is an organization account.'], ['ar', 'هذا حساب منشأة.']] as const) {
    await page.goto(`/${locale}/opportunities/${job}`);
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.locator(`a[href$="/opportunities/${job}/apply"]`)).toHaveCount(0);
    await page.goto(`/${locale}/opportunities/${job}/apply`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/organization/[0-9a-f-]{36}`));
    for (const path of ['/onboarding', '/applications', '/assessments', '/development']) {
      await page.goto(`/${locale}${path}`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/organization/[0-9a-f-]{36}`));
    }
  }
});

test('a stale or unknown address shows the not-found page, never an error', async ({ browser }) => {
  const owner = await (await signedIn(browser, 'ORG_A_OWNER')).newPage();
  for (const [locale, title] of [['en', 'This field is empty'], ['ar', 'هذا الميدان فاضي']] as const) {
    for (const path of [`/opportunities/${UNKNOWN}`, `/organization/${UNKNOWN}`, `/organization/${org}/review/${UNKNOWN}`, `/organization/${org}/applicants/${UNKNOWN}`]) {
      await owner.goto(`/${locale}${path}`);
      await expect(owner.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(owner.getByText(/Something broke on our side|صار خلل عندنا/)).toHaveCount(0);
    }
  }
});

test('an ended session goes to sign-in instead of looping', async ({ browser }) => {
  const { access_token } = await token('CANDIDATE_TWO');
  const [h, p, s] = access_token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const context = await browser.newContext();
  await context.addCookies([{ domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', name: 'midan_at', value: `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}` }]);
  const page = await context.newPage();
  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/login/);
  await expect(page.locator('input[name=email]')).toBeVisible();
});
