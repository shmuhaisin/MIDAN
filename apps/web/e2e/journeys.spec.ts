// Browser journeys against the running web app, API and real Supabase project. Accounts are signed in
// by setting session cookies from a token, so no password passes through a page. Set SHOTS to save screenshots.
// Leftovers are removed by supabase/test-cleanup.sql.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const root = resolve(__dirname, '../../..');
const env: Record<string, string | undefined> = {};
for (const f of ['.env', '.env.test.local']) {
  if (existsSync(resolve(root, f))) Object.assign(env, parseEnv(readFileSync(resolve(root, f), 'utf8')));
}
const RUN = Date.now().toString(36);
const SHOTS = process.env.SHOTS;

async function signedIn(browser: Browser, who: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  const { access_token, refresh_token } = await res.json();
  const context = await browser.newContext(options);
  const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
  await context.addCookies([
    { ...cookie, name: 'midan_at', value: access_token },
    { ...cookie, name: 'midan_rt', value: refresh_token },
  ]);
  return context;
}

async function noOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

test('signed-out visitors can browse, and private pages send them to sign-in', async ({ page }) => {
  await page.goto('/ar/opportunities');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('فرص تثبت فيها عملك');
  await expect(page.getByRole('link', { name: /محلل بيانات/ })).toBeVisible();

  await page.getByRole('searchbox').fill('لا يوجد شيء بهذا الاسم');
  await expect(page.getByText('ما لقيت شي بهذا البحث')).toBeVisible();
  await page.getByRole('button', { name: 'مسح البحث' }).click();
  await page.getByRole('link', { name: /محلل بيانات/ }).click();
  await expect(page.getByText('هذه وظيفة خيالية')).toBeVisible();
  await page.getByRole('link', { name: 'سجّل دخولك للتقديم' }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);

  for (const path of ['/en/dashboard', '/en/profile', '/en/organization/new']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/login$/);
  }
});

test('forms explain mistakes in the visitor\'s language', async ({ page }) => {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill('nobody@example.com');
  await page.getByLabel('كلمة المرور').fill('not-a-real-password');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'البريد أو كلمة المرور غير صحيحة' })).toBeVisible();

  await page.goto('/en/register?as=organization');
  await expect(page.getByRole('radio', { name: 'Organization' })).toBeChecked();
  await page.getByLabel('Name').fill('Someone');
  await page.getByLabel('Email').fill('not-an-email@x');
  await page.getByLabel('Password').fill('longenough1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'valid email' })).toBeVisible();
});

test('organization and candidate complete a full hiring journey, isolated from another organization', async ({ browser }) => {
  const owner = await (await signedIn(browser, 'ORG_A_OWNER')).newPage();
  const candidate = await (await signedIn(browser, 'CANDIDATE_ONE')).newPage();
  const outsider = await (await signedIn(browser, 'ORG_B_OWNER')).newPage();
  const jobTitle = `Field Analyst ${RUN}`;

  await owner.goto('/en/organization/new');
  await owner.getByLabel('Name in Arabic').fill('منشأة اختبار');
  await owner.getByLabel('Name in English').fill(`Midan Test UI ${RUN}`);
  await expect(owner.getByLabel('Organization link')).toHaveValue(`midan-test-ui-${RUN}`);
  await owner.getByRole('button', { name: 'Create organization' }).click();
  await expect(owner).toHaveURL(/\/en\/organization\/[0-9a-f-]{36}$/);
  await expect(owner.getByText('Your role: Owner')).toBeVisible();
  const orgUrl = new URL(owner.url()).pathname;

  await owner.getByRole('button', { name: 'New job' }).click();
  await owner.getByLabel('Title in Arabic').fill('محلل ميداني');
  await owner.getByLabel('Title in English').fill(jobTitle);
  await owner.getByRole('button', { name: 'Save as draft' }).click();
  const row = owner.getByRole('listitem').filter({ hasText: jobTitle });
  await expect(row.getByText('Draft')).toBeVisible();

  await candidate.goto('/en/opportunities');
  await expect(candidate.getByRole('link', { name: new RegExp(jobTitle) })).toHaveCount(0);

  await row.getByRole('button', { name: 'Publish' }).click();
  await expect(row.getByText('Published')).toBeVisible();

  await candidate.goto('/en/profile');
  await candidate.getByLabel('Full name').fill('Test Candidate One');
  await candidate.getByLabel('Professional headline').fill('Test analyst');
  await candidate.getByRole('button', { name: 'Save profile' }).click();
  await expect(candidate.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await candidate.goto('/en/opportunities');
  await candidate.getByRole('searchbox').fill(jobTitle);
  await candidate.getByRole('link', { name: new RegExp(jobTitle) }).click();
  await candidate.getByRole('button', { name: 'Apply for this job' }).click();
  await expect(candidate.getByRole('status').filter({ hasText: 'Your application was sent' })).toBeVisible();

  await owner.reload();
  const applicant = owner.getByRole('listitem').filter({ hasText: 'Test Candidate One' });
  await expect(applicant).toBeVisible();
  await applicant.getByRole('combobox').selectOption('under_review');
  await expect(applicant.getByRole('combobox')).toBeEnabled();

  await outsider.goto(orgUrl);
  await expect(outsider.getByRole('heading', { level: 1 })).toHaveText('This field is empty');
  await expect(outsider.getByText('Test Candidate One')).toHaveCount(0);

  await candidate.goto('/en/dashboard');
  const mine = candidate.getByRole('listitem').filter({ hasText: jobTitle });
  await expect(mine.getByText('Under review')).toBeVisible();

  await mine.getByRole('button', { name: 'Withdraw' }).click();
  await mine.getByRole('alertdialog').getByRole('button', { name: 'Withdraw' }).click();
  await expect(mine.getByText('Withdrawn')).toBeVisible();

  await owner.reload();
  await expect(owner.getByText('Test Candidate One')).toHaveCount(0);
});

for (const locale of ['ar', 'en']) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`product screens: ${locale} ${colorScheme}`, async ({ browser }) => {
      const context = await signedIn(browser, 'ORG_A_OWNER', { colorScheme, viewport: { width: 1280, height: 860 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(`/${locale}/dashboard`);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      const firstOrg = page.locator('a[href*="/organization/"]:not([href$="/new"])').first();
      const orgHref = await firstOrg.getAttribute('href');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-${locale}-${colorScheme}.png` });

      for (const [name, path] of [['org', orgHref], ['jobs', `/${locale}/opportunities`], ['profile', `/${locale}/profile`]] as const) {
        await page.goto(path as string);
        await page.waitForLoadState('networkidle');
        await noOverflow(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${locale}-${colorScheme}.png` });
      }

      await page.setViewportSize({ width: 375, height: 812 });
      for (const path of [`/${locale}/dashboard`, orgHref as string, `/${locale}/opportunities`]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await noOverflow(page);
      }
      if (SHOTS && colorScheme === 'light') {
        await page.goto(orgHref as string);
        await page.screenshot({ path: `${SHOTS}/org-mobile-${locale}.png`, fullPage: true });
      }
      await context.close();
      expect(errors).toEqual([]);
    });
  }
}
