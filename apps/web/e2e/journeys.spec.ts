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

/** Applying goes through a review page, and needs a profile with a name. */
async function applyFromJobPage(page: Page) {
  await page.getByRole('link', { name: 'Apply for this job' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm application' });
  const needProfile = page.getByRole('link', { name: 'Complete my profile' });
  await expect(confirm.or(needProfile)).toBeVisible();
  if (await needProfile.isVisible()) {
    const back = page.url();
    await needProfile.click();
    await page.getByLabel('Full name').fill('Test Candidate');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/step=2/);
    await page.goto(back);
  }
  await confirm.click();
}

async function noOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

test('the dashboard works for an account with no profile, no applications and no organization', async ({ browser }) => {
  const page = await (await signedIn(browser, 'ORG_A_RECRUITER')).newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  const response = await page.goto('/en/dashboard');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'My applications' })).toBeVisible();
  await expect(page.getByText("You haven't applied to anything yet.")).toBeVisible();
  await expect(page.getByText('Something broke on our side')).toHaveCount(0);
  await page.getByRole('link', { name: /Complete your profile/ }).first().click();
  await expect(page).toHaveURL(/\/en\/profile$/);
  await expect(page.getByLabel('Full name')).toBeVisible();
  expect(problems).toEqual([]);
});

test('signed-out visitors can browse, and private pages send them to sign-in', async ({ page }) => {
  await page.goto('/ar/opportunities');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('فرص تثبت فيها عملك');
  // With no genuine jobs the page says so, and demo jobs have their own labeled list.
  await expect(page.getByText('لا توجد وظائف منشورة الآن')).toBeVisible();
  await page.goto('/ar/opportunities?demo=1');
  await page.getByRole('searchbox').fill('لا يوجد شيء بهذا الاسم');
  await expect(page.getByText('ما لقيت شي بهذا البحث')).toBeVisible();
  await page.getByRole('button', { name: 'مسح التصفية' }).last().click();
  await page.getByRole('link', { name: /محلل بيانات/ }).first().click();
  await expect(page.getByText('هذه وظيفة خيالية')).toBeVisible();
  await page.getByRole('link', { name: 'سجّل دخولك للتقديم' }).click();
  await expect(page).toHaveURL(/\/ar\/login(\?next=.*)?$/);

  for (const path of ['/en/dashboard', '/en/profile', '/en/organization/new']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/login(\?(as=organization|next=.*))?$/);
  }
});

test('forms explain mistakes in the visitor\'s language', async ({ page }) => {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill('nobody@example.com');
  await page.getByLabel('كلمة المرور').fill('not-a-real-password');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'البريد أو كلمة المرور غير صحيحة' })).toBeVisible();

  await page.goto('/en/register?as=organization');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Register your organization');
  await page.getByLabel('Name', { exact: true }).fill('Someone');
  await page.getByLabel('Organization name in Arabic').fill('منشأة');
  await page.getByLabel('Organization name in English').fill('Org');
  await page.getByLabel('Email').fill('not-an-email@x'); // Refused by the form's own check, so nothing is sent.
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
  await candidate.getByRole('link', { name: jobTitle, exact: true }).click();
  await applyFromJobPage(candidate);
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

test('the full MVP journey: details, draft, publish, work, evaluate, review, release, report', async ({ browser }) => {
  const owner = await (await signedIn(browser, 'ORG_A_OWNER')).newPage();
  const candidate = await (await signedIn(browser, 'CANDIDATE_TWO')).newPage();
  const outsider = await (await signedIn(browser, 'ORG_B_OWNER')).newPage();
  const name = `MVP Analyst ${RUN}`;
  const problems: string[] = [];
  for (const page of [owner, candidate]) {
    page.on('pageerror', (e) => problems.push(`${page.url()} ${e.message}`));
    page.on('console', (m) => {
      // 403 and 404 responses are expected in this journey; browsers log them as errors.
      if (m.type() === 'error' && !m.text().includes('Failed to load resource')) problems.push(`${page.url()} ${m.text()}`);
    });
  }

  await owner.goto('/en/organization/new');
  await owner.getByLabel('Name in Arabic').fill('منشأة مسار كامل');
  await owner.getByLabel('Name in English').fill(`Midan Test Flow ${RUN}`);
  await owner.getByRole('button', { name: 'Create organization' }).click();
  await expect(owner.getByText('Your role: Owner')).toBeVisible();
  const orgPath = new URL(owner.url()).pathname;

  await owner.getByRole('button', { name: 'New job' }).click();
  await owner.getByLabel('Title in Arabic').fill('محلل مسار');
  await owner.getByLabel('Title in English').fill(name);
  await owner.getByRole('button', { name: 'Save as draft' }).click();
  await owner.getByRole('link', { name }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(name);
  const jobPath = new URL(owner.url()).pathname;

  await owner.getByLabel('Description and responsibilities in English').fill('Prepare monthly reports for management.\nInvestigate order returns.');
  await owner.getByLabel('Description and responsibilities in Arabic').fill('إعداد التقارير الشهرية للإدارة.\nتحليل المرتجعات.');
  await owner.getByRole('checkbox', { name: 'Data analysis' }).check();
  await owner.getByRole('checkbox', { name: 'Written communication' }).check();
  await owner.getByRole('button', { name: 'Save details' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await owner.getByRole('button', { name: 'Create assessment draft' }).click();
  await expect(owner.getByText('Demo mode: this draft was built from templates')).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByText('Version 1 · Draft')).toBeVisible();

  // Edit, then confirm the edit persisted.
  await owner.getByRole('button', { name: /A case study from the role/ }).first().click();
  await owner.locator('form').filter({ has: owner.getByRole('button', { name: 'Save task' }) }).getByLabel('Title in English').fill(`Edited case ${RUN}`);
  await owner.getByRole('button', { name: 'Save task' }).click();
  await expect(owner.getByRole('button', { name: new RegExp(`Edited case ${RUN}`) })).toBeVisible();

  await owner.getByRole('link', { name: 'Preview what candidates see' }).click();
  await expect(owner.getByText('Preview: this is what candidates see')).toBeVisible();
  const previewPath = new URL(owner.url()).pathname;
  if (SHOTS) {
    await owner.goto(previewPath.replace('/en/', '/ar/'));
    await owner.getByRole('button', { name: 'ابدأ التقييم' }).click();
    await owner.getByRole('button', { name: 'التالية' }).click();
    await owner.getByRole('button', { name: 'التالية' }).click();
    await owner.screenshot({ path: `${SHOTS}/experience-ar.png`, fullPage: true });
  }
  await owner.goto(jobPath);

  await owner.getByRole('button', { name: 'Approve and publish this version' }).click();
  await owner.getByRole('button', { name: 'Confirm publishing' }).click();
  await expect(owner.getByText('This version is published and fixed')).toBeVisible({ timeout: 40_000 });
  await owner.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Back to draft' })).toBeVisible();

  const jobId = jobPath.split('/').pop();
  await candidate.goto(`/en/opportunities/${jobId}`);
  await expect(candidate.getByRole('listitem').filter({ hasText: 'Data analysis' }).first()).toBeVisible();
  await applyFromJobPage(candidate);
  await expect(candidate.getByRole('status').filter({ hasText: 'Your application was sent' })).toBeVisible();

  // The approved assessment was assigned on applying, with no separate invitation.
  await owner.reload();
  await expect(owner.getByText('Invited', { exact: true })).toBeVisible();

  await candidate.goto('/en/dashboard');
  await candidate.getByRole('listitem').filter({ hasText: name }).getByRole('link', { name: 'Start assessment' }).click();
  await expect(candidate.getByRole('heading', { level: 1 })).toContainText('practical assessment');
  await candidate.getByRole('button', { name: 'Start the assessment' }).click();

  const experienceUrl = candidate.url();
  const answer = 'Returns in Jeddah rose from 40 to 61 over three months. I would audit that region first. Then I would report returns monthly and check the change.';
  const box = () => candidate.getByRole('textbox', { name: 'Your answer' });

  await expect(box()).toBeVisible();
  await box().fill(answer);
  await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
  await candidate.reload(); // Autosave survives a reload.
  await expect(box()).toHaveValue(answer);

  // Walk every task. Open tasks get text; the data task also gets a file; objective tasks get choices.
  for (let i = 0; i < 6; i++) {
    if (await box().isVisible()) {
      if (!(await box().inputValue())) {
        await box().fill(answer);
        await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
      }
      if (await candidate.getByRole('heading', { name: 'Supplied data', exact: true }).isVisible()) {
        await candidate.locator('input[type=file]').setInputFiles({ name: 'work.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
        await expect(candidate.getByText('work.csv')).toBeVisible({ timeout: 30_000 });
      }
    } else {
      await candidate.getByRole('radio', { name: 'Check its impact' }).check();
      await candidate.getByRole('radio', { name: "Say what I know" }).check();
      await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
    }
    const next = candidate.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.isVisible())) break;
    await next.click();
  }
  await candidate.getByRole('button', { name: 'Review and submit' }).last().click();
  await expect(candidate.getByText('Not answered yet')).toHaveCount(0);
  await candidate.getByRole('button', { name: 'Submit for good' }).click();
  await expect(candidate.getByText('Your work is in')).toBeVisible();
  await candidate.goto(experienceUrl);
  await expect(candidate.getByText('Your work is in')).toBeVisible();

  await owner.reload();
  await owner.getByRole('link', { name: 'Review the work' }).click();
  await expect(owner).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
  const reviewPath = new URL(owner.url()).pathname;
  await outsider.goto(reviewPath);
  await expect(outsider.getByRole('heading', { level: 1 })).toHaveText('This field is empty');

  await owner.getByRole('button', { name: 'Run AI-assisted evaluation' }).click();
  await expect(owner.getByText('Demo mode: these proposed scores')).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByText('The system is running in demo mode')).toBeVisible();
  const evidenceResponse = owner.context().waitForEvent('response', (r) => r.url().includes('/storage/v1/object/sign/assessment-evidence/'));
  await owner.getByRole('button', { name: /Open: work\.csv/ }).click();
  expect((await evidenceResponse).status()).toBe(200);
  await owner.getByLabel('Your score').first().fill('9');
  await owner.getByLabel('Internal notes').fill('INTERNAL-NOTE-UI');
  await owner.getByRole('button', { name: 'Approve the review' }).click();
  await expect(owner.getByRole('heading', { name: 'Reviewed' })).toBeVisible({ timeout: 40_000 });

  await candidate.goto('/en/dashboard');
  await expect(candidate.getByRole('listitem').filter({ hasText: name }).getByRole('link', { name: 'View report' })).toHaveCount(0);

  await owner.getByRole('button', { name: 'Release result to candidate' }).click();
  await expect(owner.getByText('Result released to candidate')).toBeVisible();

  await candidate.reload();
  await candidate.getByRole('listitem').filter({ hasText: name }).getByRole('link', { name: 'View report' }).click();
  await expect(candidate.getByRole('heading', { level: 1 })).toHaveText('What your work showed');
  await expect(candidate.getByText('A report from a demo stage')).toBeVisible();
  await expect(candidate.getByText('Data analysis').first()).toBeVisible();
  await expect(candidate.getByText('INTERNAL-NOTE-UI')).toHaveCount(0);
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/report-en.png`, fullPage: true });
  await outsider.goto(new URL(candidate.url()).pathname);
  await expect(outsider.getByRole('heading', { level: 1 })).toHaveText('This field is empty');

  await owner.goto(jobPath);
  await expect(owner.getByText('Compare candidates on the same criteria')).toBeVisible();
  await expect(owner.getByRole('rowheader').first()).toBeVisible();
  if (SHOTS) {
    await owner.screenshot({ path: `${SHOTS}/workspace-en.png`, fullPage: true });
    await owner.goto(reviewPath);
    await owner.screenshot({ path: `${SHOTS}/review-en.png`, fullPage: true });
    await owner.goto(reviewPath.replace('/en/', '/ar/'));
    await owner.screenshot({ path: `${SHOTS}/review-ar.png`, fullPage: true });
  }
  expect(orgPath).toContain('/organization/');
  expect(problems).toEqual([]);
});

test('the sign-up page explains the development testing flow', async ({ page }) => {
  await page.goto('/en/register');
  await expect(page.getByText('Development testing environment')).toBeVisible();
  await expect(page.getByText('needs email verification')).toBeVisible();
  // Never submitted here: this server would send a real email. The form itself is covered in e2e-forms.
  await page.goto('/en/register?as=organization');
  await expect(page.getByLabel('Organization name in English')).toBeVisible();
});

test('the verification landing page handles success and failure', async ({ page }) => {
  await page.goto('/en/auth/confirmed#access_token=abc&refresh_token=def&type=signup');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your email is confirmed');
  await expect(page).toHaveURL(/\/en\/auth\/confirmed$/);
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  await page.goto('/ar/auth/confirmed#error=access_denied&error_code=otp_expired');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعذر تأكيد البريد');
});

test('sessions: an expired token renews from the real refresh token, and sign-out ends the session', async ({ browser }) => {
  const context = await signedIn(browser, 'CANDIDATE_ONE');
  const page = await context.newPage();
  const cookies = await context.cookies();
  const access = cookies.find((c) => c.name === 'midan_at') as { value: string };
  const [header, payload] = access.value.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const expired = Buffer.from(JSON.stringify({ ...claims, exp: 1000 })).toString('base64url');
  const forged = `${header}.${expired}.x`;
  await context.addCookies([{ name: 'midan_at', value: forged, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);

  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  const renewed = (await context.cookies()).find((c) => c.name === 'midan_at') as { value: string };
  expect(renewed.value).not.toBe(forged);
  const live = renewed.value;

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en$/);
  expect((await context.cookies()).filter((c) => c.name.startsWith('midan_'))).toEqual([]);
  const after = await fetch('http://localhost:4000/v1/me', { headers: { authorization: `Bearer ${live}` } });
  expect(after.status).toBe(401);
  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('accounts land where their role belongs', async ({ browser }) => {
  const owner = await (await signedIn(browser, 'ORG_B_OWNER')).newPage();
  await owner.goto('/en/dashboard');
  await expect(owner).toHaveURL(/\/en\/organization\/(new|[0-9a-f-]{36})$/);
  await owner.goto('/en/opportunities?demo=1');
  await owner.getByRole('link', { name: /Data Analyst/ }).first().click();
  await expect(owner.getByText('This is an organization account')).toBeVisible();
  await expect(owner.getByRole('link', { name: 'Apply for this job' })).toHaveCount(0);

  const candidate = await (await signedIn(browser, 'CANDIDATE_TWO')).newPage();
  await candidate.goto('/en/organization/new');
  await expect(candidate).toHaveURL(/\/en\/dashboard$/);
  await expect(candidate.getByRole('link', { name: 'Create an organization' })).toHaveCount(0);
});

test('a candidate builds a full profile and CV, and only the organization applied to can see it', async ({ browser }) => {
  const candidate = await (await signedIn(browser, 'CANDIDATE_ONE', { viewport: { width: 1280, height: 900 } })).newPage();
  const owner = await (await signedIn(browser, 'ORG_A_OWNER')).newPage();
  const outsider = await (await signedIn(browser, 'ORG_B_OWNER')).newPage();
  const problems: string[] = [];
  candidate.on('pageerror', (e) => problems.push(e.message));

  await candidate.goto('/en/profile');
  await expect(candidate.getByText("don't upload your real CV")).toBeVisible();
  await candidate.getByLabel('Full name').fill('Test Candidate One');
  await candidate.getByLabel('Professional headline').fill('Fictional analyst');
  await candidate.getByLabel('City').fill('Riyadh');
  await candidate.getByLabel('Years of experience').fill('3');
  await candidate.getByLabel('About you').fill('A fictional summary for testing.');

  await candidate.getByRole('button', { name: 'Add experience' }).click();
  await candidate.getByLabel('Job title', { exact: true }).last().fill('Junior Analyst');
  await candidate.getByLabel('Organization', { exact: true }).last().fill('Fictional Co');
  const experience = candidate.getByRole('group', { name: 'Experience' });
  await experience.getByLabel('Start year').last().fill('2020');
  await experience.getByLabel('End year').last().fill('2010');

  await candidate.getByRole('button', { name: 'Add a qualification' }).click();
  await candidate.getByLabel('Institution', { exact: true }).last().fill('Fictional University');
  await candidate.getByLabel('Qualification', { exact: true }).last().fill('BSc');
  await candidate.getByRole('group', { name: 'Education' }).getByLabel('Start year').last().fill('2015');

  await candidate.getByRole('button', { name: 'Save profile' }).click();
  await expect(candidate.getByRole('alert').filter({ hasText: 'Check the years' })).toBeVisible();
  await expect(candidate.getByLabel('Job title', { exact: true }).last()).toHaveValue('Junior Analyst'); // Nothing typed is lost.

  await experience.getByLabel('End year').last().fill('');
  await candidate.getByRole('button', { name: 'Save profile' }).click();
  await expect(candidate.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await candidate.getByRole('searchbox', { name: 'Search for a skill' }).fill('تحليل البيانات');
  await candidate.getByRole('button', { name: /تحليل البيانات/ }).first().click({ timeout: 20_000 });
  await expect(candidate.getByRole('heading', { name: 'Your skills (1)' })).toBeVisible();
  await expect(candidate.getByText('Saved', { exact: true }).last()).toBeVisible();

  await candidate.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(candidate.getByRole('alert').filter({ hasText: 'Upload a PDF or Word file' })).toBeVisible();
  await candidate.locator('input[type=file]').setInputFiles({ name: 'fictional.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictional') });
  await expect(candidate.getByText('You have a CV on file')).toBeVisible({ timeout: 40_000 });
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/profile-en.png`, fullPage: true });

  await candidate.reload();
  await expect(candidate.getByLabel('Job title', { exact: true }).last()).toHaveValue('Junior Analyst');
  await expect(candidate.getByLabel('Institution', { exact: true }).last()).toHaveValue('Fictional University');
  await expect(candidate.getByRole('heading', { name: 'Your skills (1)' })).toBeVisible();
  await expect(candidate.getByText('You have a CV on file')).toBeVisible();

  await candidate.goto('/ar/profile');
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/profile-ar.png`, fullPage: true });
  await candidate.goto('/en/dashboard');
  await expect(candidate.getByText('5 of 6 complete').or(candidate.getByText('6 of 6 complete'))).toBeVisible();

  // Applies, then appears to that organization only.
  await owner.goto('/en/organization/new');
  await owner.getByLabel('Name in Arabic').fill('منشأة ملف');
  await owner.getByLabel('Name in English').fill(`Midan Test Profile ${RUN}`);
  await owner.getByRole('button', { name: 'Create organization' }).click();
  await expect(owner.getByText('Your role: Owner')).toBeVisible();
  await owner.getByRole('button', { name: 'New job' }).click();
  await owner.getByLabel('Title in Arabic').fill('وظيفة ملف');
  await owner.getByLabel('Title in English').fill(`Profile Role ${RUN}`);
  await owner.getByRole('button', { name: 'Save as draft' }).click();
  const row = owner.getByRole('listitem').filter({ hasText: `Profile Role ${RUN}` });
  await row.getByRole('button', { name: 'Publish' }).click();
  await expect(row.getByText('Published')).toBeVisible();
  await row.getByRole('link', { name: `Profile Role ${RUN}` }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(`Profile Role ${RUN}`);
  const jobId = new URL(owner.url()).pathname.split('/').pop();

  await candidate.goto(`/en/opportunities/${jobId}`);
  await applyFromJobPage(candidate);
  await expect(candidate.getByRole('status').filter({ hasText: 'Your application was sent' })).toBeVisible();

  await owner.reload();
  await owner.getByRole('link', { name: 'Test Candidate One' }).click();
  await expect(owner).toHaveURL(/\/applicants\/[0-9a-f-]{36}$/);
  await expect(owner.getByText('Junior Analyst · Fictional Co').first()).toBeVisible();
  await expect(owner.getByText('Self-reported and not assessed')).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Open CV' })).toBeVisible();
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/applicant-en.png`, fullPage: true });
  const applicantPath = new URL(owner.url()).pathname;

  const cvResponse = owner.context().waitForEvent('response', (r) => r.url().includes('/storage/v1/object/sign/candidate-documents/'));
  await owner.getByRole('button', { name: 'Open CV' }).click();
  expect((await cvResponse).status()).toBe(200);

  await outsider.goto(applicantPath);
  await expect(outsider.getByRole('heading', { level: 1 })).toHaveText('This field is empty');

  await candidate.goto('/en/dashboard');
  const mine = candidate.getByRole('listitem').filter({ hasText: `Profile Role ${RUN}` });
  await mine.getByRole('button', { name: 'Withdraw' }).click();
  await mine.getByRole('alertdialog').getByRole('button', { name: 'Withdraw' }).click();
  await expect(mine.getByText('Withdrawn')).toBeVisible();
  await owner.goto(applicantPath);
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText('This field is empty');
  expect(problems).toEqual([]);
});

test('no error badge: switching language and saving re-render the layout without console errors', async ({ browser }) => {
  const page = await (await signedIn(browser, 'CANDIDATE_ONE')).newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) problems.push(m.text());
  });
  await page.goto('/en/profile');
  await page.getByLabel('Full name').fill('Test Candidate One');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page).toHaveURL(/\/ar\/profile$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ملفك المهني');
  await page.getByRole('button', { name: 'English' }).first().click();
  await expect(page).toHaveURL(/\/en\/profile$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(problems).toEqual([]);
});

test('requirements: a job gets structured requirements, tasks measure them, and publishing freezes them', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await (await signedIn(browser, 'ORG_A_OWNER', { viewport: { width: 1280, height: 900 } })).newPage();
  const visitor = await (await browser.newContext()).newPage();
  const name = `Requirements Role ${RUN}`;
  const problems: string[] = [];
  owner.on('pageerror', (e) => problems.push(e.message));

  await owner.goto('/en/organization/new');
  await owner.getByLabel('Name in Arabic').fill('منشأة متطلبات');
  await owner.getByLabel('Name in English').fill(`Midan Test Req ${RUN}`);
  await owner.getByRole('button', { name: 'Create organization' }).click();
  await expect(owner.getByText('Your role: Owner')).toBeVisible();
  await owner.getByRole('button', { name: 'New job' }).click();
  await owner.getByLabel('Title in Arabic').fill('دور متطلبات');
  await owner.getByLabel('Title in English').fill(name);
  await owner.getByRole('button', { name: 'Save as draft' }).click();
  await owner.getByRole('link', { name }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(name);
  const jobId = new URL(owner.url()).pathname.split('/').pop();
  await expect(owner.getByText('No requirements yet.')).toBeVisible();

  // Nothing written: a clear message, and nothing is lost.
  await owner.getByRole('button', { name: 'Add a requirement' }).click();
  await owner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(owner.getByRole('alert').filter({ hasText: 'at least one language' })).toBeVisible();

  await owner.getByLabel('Description in English').last().fill('Analyze campaign performance');
  await owner.getByLabel('Description in Arabic').last().fill('تحليل أداء الحملات');
  await owner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(owner.getByText('Analyze campaign performance')).toBeVisible();

  await owner.getByRole('button', { name: 'Add a requirement' }).click();
  await owner.getByRole('combobox', { name: /^Type/ }).selectOption('experience');
  await owner.getByLabel('Description in English').last().fill('Digital marketing experience');
  await owner.getByLabel('Minimum years of experience').fill('3');
  await owner.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(owner.getByText('At least 3 years')).toBeVisible();

  await owner.getByRole('button', { name: 'Create assessment draft' }).click();
  await expect(owner.getByText('Version 1 · Draft')).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByText('0 of 2 required items are measured by a task')).toBeVisible();
  await expect(owner.getByText('No task measures this yet').first()).toBeVisible();

  await owner.getByRole('button', { name: /A case study from the role/ }).first().click();
  await owner.getByRole('group', { name: 'Requirements this task measures' }).getByLabel('Analyze campaign performance').check();
  await owner.getByRole('button', { name: 'Save links' }).click();
  await expect(owner.getByText('1 of 2 required items are measured by a task')).toBeVisible();
  await expect(owner.getByText('Measured by:')).toBeVisible();

  await owner.getByRole('button', { name: 'Approve and publish this version' }).click();
  await owner.getByRole('button', { name: 'Confirm publishing' }).click();
  await expect(owner.getByText('later edits won\'t change them')).toBeVisible({ timeout: 40_000 });
  await owner.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Back to draft' })).toBeVisible();

  await visitor.goto(`/en/opportunities/${jobId}`);
  await expect(visitor.getByRole('heading', { name: 'Responsibilities' })).toBeVisible();
  await expect(visitor.getByText('Analyze campaign performance')).toBeVisible();
  await expect(visitor.getByText('At least 3 years')).toBeVisible();
  await expect(visitor.getByText('measured by')).toHaveCount(0);
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/requirements-en.png`, fullPage: true });
  await owner.goto(`/ar/organization/${new URL(owner.url()).pathname.split('/')[3]}/jobs/${jobId}`);
  await expect(owner.getByRole('heading', { name: 'المسؤوليات' })).toBeVisible();
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/requirements-ar.png`, fullPage: true });
  expect(problems).toEqual([]);
});

test('several assessments: each has its own draft, invitation and address, and the status waits for all of them', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = await (await signedIn(browser, 'ORG_A_OWNER', { viewport: { width: 1280, height: 900 } })).newPage();
  const candidate = await (await signedIn(browser, 'CANDIDATE_ONE', { viewport: { width: 390, height: 844 } })).newPage();
  const name = `Two Assessments ${RUN}`;
  const problems: string[] = [];
  owner.on('pageerror', (e) => problems.push(e.message));
  candidate.on('pageerror', (e) => problems.push(e.message));

  await owner.goto('/en/organization/new');
  await owner.getByLabel('Name in Arabic').fill('منشأة تقييمين');
  await owner.getByLabel('Name in English').fill(`Midan Test Two ${RUN}`);
  await owner.getByRole('button', { name: 'Create organization' }).click();
  await expect(owner.getByText('Your role: Owner')).toBeVisible();
  await owner.getByRole('button', { name: 'New job' }).click();
  await owner.getByLabel('Title in Arabic').fill('دور بتقييمين');
  await owner.getByLabel('Title in English').fill(name);
  await owner.getByRole('button', { name: 'Save as draft' }).click();
  await owner.getByRole('link', { name }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(name);
  await owner.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Back to draft' })).toBeVisible();
  const jobId = new URL(owner.url()).pathname.split('/').pop();

  await owner.getByRole('button', { name: 'Create assessment draft' }).click();
  await expect(owner.getByText('Version 1 · Draft')).toBeVisible({ timeout: 60_000 });
  const switcher = owner.getByRole('navigation', { name: 'Assessments for this job' });
  await expect(switcher.getByRole('link')).toHaveCount(1);

  await owner.getByRole('button', { name: 'Add another assessment' }).click();
  await owner.getByLabel('Assessment title in Arabic').fill('تقييم البيانات');
  await owner.getByLabel('Assessment title in English').fill('Data assessment');
  await owner.getByRole('button', { name: 'Create draft' }).click();
  await expect(owner).toHaveURL(/assessment=/, { timeout: 60_000 });
  await expect(switcher.getByRole('link')).toHaveCount(2);
  await expect(owner.getByRole('heading', { name: 'Data assessment' })).toBeVisible();
  await expect(switcher.getByRole('link', { name: /Data assessment/ })).toHaveAttribute('aria-current', 'page');

  // A mistaken draft can be removed, and publishing removes that option.
  await owner.getByRole('button', { name: 'Add another assessment' }).click();
  await owner.getByLabel('Assessment title in Arabic').fill('مؤقت');
  await owner.getByLabel('Assessment title in English').fill('Temporary');
  await owner.getByRole('button', { name: 'Create draft' }).click();
  await expect(owner.getByRole('heading', { name: 'Temporary' })).toBeVisible({ timeout: 60_000 });
  await owner.getByRole('button', { name: 'Remove this draft' }).click();
  await owner.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(switcher.getByRole('link')).toHaveCount(2);

  // Renaming, then publishing each in turn.
  await switcher.getByRole('link', { name: /Data assessment/ }).click();
  await expect(owner.getByRole('heading', { name: 'Data assessment' })).toBeVisible();
  await owner.getByRole('button', { name: 'Rename' }).click();
  await owner.getByLabel('Assessment title in English').fill('Data work');
  await owner.getByRole('button', { name: 'Save title' }).click();
  await expect(owner.getByRole('heading', { name: 'Data work' })).toBeVisible();
  for (const link of [/Data work/, new RegExp(name)]) {
    await switcher.getByRole('link', { name: link }).click();
    await expect(owner.getByRole('heading', { level: 3, name: link })).toBeVisible();
    await expect(owner.getByText('Version 1 · Draft')).toBeVisible();
    await owner.getByRole('button', { name: 'Approve and publish this version' }).click();
    await owner.getByRole('button', { name: 'Confirm publishing' }).click();
    await expect(owner.getByText('Version 1 · Published')).toBeVisible({ timeout: 40_000 });
    await expect(owner.getByRole('button', { name: 'Remove this draft' })).toHaveCount(0);
  }

  await candidate.goto(`/en/opportunities/${jobId}`);
  await applyFromJobPage(candidate);
  await expect(candidate.getByRole('status').filter({ hasText: 'Your application was sent' })).toBeVisible();

  await owner.reload();
  // Every published assessment is assigned on applying.
  await expect(owner.getByText('Invited', { exact: true })).toHaveCount(2);

  await candidate.goto('/en/dashboard');
  await expect(candidate.getByRole('link', { name: 'Start assessment: Data work' })).toBeVisible();
  const start = candidate.getByRole('link', { name: `Start assessment: ${name}` });
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute('href', /\/experience\/.+\/[0-9a-f-]{36}$/);
  await candidate.getByRole('link', { name: 'Start assessment: Data work' }).click();
  await expect(candidate).toHaveURL(/\/experience\//);
  await expect(candidate.getByText('Data work')).toBeVisible();
  await noOverflow(candidate);

  // The address from before a job could have several assessments still arrives somewhere real.
  const path = new URL(candidate.url()).pathname.split('/');
  await candidate.goto(`/en/experience/${path[3]}/${path[4]}/1`);
  await expect(candidate).toHaveURL(/\/experience\/.+\/[0-9a-f-]{36}$/);

  await owner.goto(`/ar${new URL(owner.url()).pathname.slice(3)}`);
  await expect(owner.getByRole('navigation', { name: 'تقييمات هذه الوظيفة' })).toBeVisible();
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/two-assessments-ar.png`, fullPage: true });
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/two-assessments-candidate.png` });
  expect(problems).toEqual([]);
});
