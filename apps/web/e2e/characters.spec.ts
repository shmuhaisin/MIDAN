// Every Humaidan placement rule, checked by the actual image files on real pages.
// Accounts are signed in with session cookies, so no password passes through a page. SHOTS saves screenshots.
// Leftovers are removed by supabase/test-cleanup.sql.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test, type Browser, type Page } from '@playwright/test';

const root = resolve(__dirname, '../../..');
const env: Record<string, string | undefined> = {};
for (const f of ['.env', '.env.test.local']) {
  if (existsSync(resolve(root, f))) Object.assign(env, parseEnv(readFileSync(resolve(root, f), 'utf8')));
}
const RUN = Date.now().toString(36);
const SHOTS = process.env.SHOTS;
const API = 'http://localhost:4000/v1';
const ORIGINAL = '01_Humaidan_Original.png';
const FILES: Record<string, string> = {
  finance: '02_Humaidan_Finance.png',
  legal: '03_Humaidan_Legal_Brown_Bisht.png',
  engineering: '04_Humaidan_Engineering.png',
  technology: '05_Humaidan_Tech_Cybersecurity.png',
  events: '06_Humaidan_Entertainment_Events.png',
  healthcare: '07_Humaidan_Healthcare.png',
  media: ORIGINAL,
  marketing: ORIGINAL,
};

type Session = { access_token: string; refresh_token: string };
const sessions = new Map<string, Session>();

async function token(who: string): Promise<Session> {
  if (sessions.has(who)) return sessions.get(who) as Session;
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  const session = (await res.json()) as Session;
  sessions.set(who, session);
  return session;
}

async function open(browser: Browser, who: string, options: Parameters<Browser['newContext']>[0] = {}) {
  const session = await token(who);
  const context = await browser.newContext(options);
  const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
  await context.addCookies([
    { ...cookie, name: 'midan_at', value: session.access_token },
    { ...cookie, name: 'midan_rt', value: session.refresh_token },
  ]);
  return context.newPage();
}

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${(await token(who)).access_token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function createOrg(who: string, name: string) {
  const slug = `midan-test-${name}-${RUN}`;
  const { body } = await call(who, 'POST', '/organizations', { slug, name_ar: `منشأة ${name}`, name_en: `Org ${name}` });
  return { id: body.id as string, slug };
}

async function createAssessment(who: string, org: { id: string }, slug: string, field: string | null) {
  const job = await call(who, 'POST', `/organizations/${org.id}/jobs`, { slug, title_ar: `وظيفة ${slug}`, title_en: `Job ${slug}`, status: 'published' });
  expect(job.status).toBe(201);
  const made = await call(who, 'POST', `/organizations/${org.id}/jobs/${job.body.id}/assessment/generate`);
  expect(made.status).toBe(201);
  const latest = await call(who, 'GET', `/organizations/${org.id}/jobs/${job.body.id}/assessment`);
  if (field) {
    const set = await call(who, 'PATCH', `/organizations/${org.id}/assessments/${latest.body.version.assessments.id}/field`, { professional_field: field });
    expect(set.status).toBe(200);
  }
  return { jobId: job.body.id as string, slug, versionId: made.body.version_id as string };
}

/** The Humaidan files actually on the page, and proof they loaded. */
async function shown(page: Page) {
  // Pages stream behind a loading screen, so wait for the real content first.
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await page.waitForLoadState('load');
  return page.evaluate(async () => {
    const images = [...document.images].filter((i) => /Humaidan/.test(decodeURIComponent(i.src)));
    await Promise.all(images.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    return images.map((i) => {
      if (!i.naturalWidth) return 'BROKEN';
      return (decodeURIComponent(i.src).match(/\d\d_Humaidan[^.&]*\.png/) ?? ['?'])[0];
    });
  });
}

const experience = (locale: string, org: { slug: string }, job: { slug: string }) => `/${locale}/experience/${org.slug}/${job.slug}/1`;

test.describe.configure({ mode: 'serial' });

test('1-3: public pages and candidate auth show Original only; employer auth shows no mascot', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();

  await page.goto('/ar');
  expect(new Set(await shown(page))).toEqual(new Set([ORIGINAL]));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/c-home-ar.png`, fullPage: true });

  for (const path of ['/en/how-it-works', '/en/for-organizations', '/en/faq']) {
    await page.goto(path);
    expect([path, await shown(page)]).toEqual([path, []]);
  }
  await page.goto('/en/for-candidates');
  expect(new Set(await shown(page))).toEqual(new Set([ORIGINAL]));

  await page.goto('/ar/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('يا هلا برجعتك للميدان');
  expect(await shown(page)).toEqual([ORIGINAL]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/c-login-ar.png` });

  await page.goto('/ar/register');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('جاهز تدخل الميدان؟');
  expect(await shown(page)).toEqual([ORIGINAL]);

  await page.goto('/en/login?as=organization');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organization sign-in');
  expect(await shown(page)).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/c-login-org-en.png` });

  await page.goto('/en/register?as=organization');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Register your organization');
  expect(await shown(page)).toEqual([]);
  await page.getByRole('link', { name: 'A candidate? Create a candidate account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ready to enter the Midan?');
  expect(await shown(page)).toEqual([ORIGINAL]);
  await context.close();
});

test('auth pages work on a phone and in dark mode, with the whole figure visible', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  for (const path of ['/ar/login', '/en/register']) {
    await page.goto(path);
    expect(await shown(page)).toEqual([ORIGINAL]);
    const box = await page.locator('img[src*="Humaidan"]').boundingBox();
    expect(box && box.width > 80 && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll).toBeLessThanOrEqual(inner);
  }
  await page.goto('/ar/login');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/c-login-mobile-dark.png`, fullPage: true });
  await context.close();
});

test('4: candidate dashboard shows Original; organization screens stay formal', async ({ browser }) => {
  const org = await createOrg('ORG_A_OWNER', 'formal');
  await call('CANDIDATE_ONE', 'PUT', '/me/candidate-profile', { full_name: 'Test Candidate One' });

  const candidate = await open(browser, 'CANDIDATE_ONE');
  await candidate.goto('/en/dashboard');
  expect(await shown(candidate)).toEqual([ORIGINAL]);

  const owner = await open(browser, 'ORG_A_OWNER');
  await owner.goto(`/en/organization/${org.id}`);
  await expect(owner.getByText('Your role: Owner')).toBeVisible();
  expect(await shown(owner)).toEqual([]);
  await owner.goto(`/en/organization/${org.id}/settings`);
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText("Your organization's identity");
});

test('5-12, 14, 17: one organization, every field, the right variant, stable through navigation', async ({ browser }) => {
  const org = await createOrg('ORG_A_OWNER', 'multi');
  const owner = await open(browser, 'ORG_A_OWNER', { viewport: { width: 1280, height: 860 } });

  for (const [field, file] of Object.entries(FILES)) {
    const job = await createAssessment('ORG_A_OWNER', org, field, field);
    await owner.goto(experience('en', org, job));
    await expect(owner.getByText('Preview: this is what candidates see')).toBeVisible();
    expect([field, await shown(owner)]).toEqual([field, [file]]);
    if (SHOTS && ['legal', 'engineering', 'marketing'].includes(field)) await owner.screenshot({ path: `${SHOTS}/c-assessment-${field}-en.png` });

    // Same answer after a reload and in the other language.
    await owner.reload();
    expect(await shown(owner)).toEqual([file]);
    await owner.goto(experience('ar', org, job));
    expect([field, await shown(owner)]).toEqual([field, [file]]);
  }
});

test('13, 15, 16: Original when unconfigured, organization default, per-organization branding, tenant limits', async ({ browser }) => {
  const a = await createOrg('ORG_A_OWNER', 'switch-a');
  const b = await createOrg('ORG_B_OWNER', 'switch-b');
  const jobA = await createAssessment('ORG_A_OWNER', a, 'no-field', null);
  const jobB = await createAssessment('ORG_B_OWNER', b, 'no-field', null);
  const owner = await open(browser, 'ORG_A_OWNER');
  const ownerB = await open(browser, 'ORG_B_OWNER');

  // 13: nothing configured.
  await owner.goto(experience('en', a, jobA));
  expect(await shown(owner)).toEqual([ORIGINAL]);

  // Organization default applies when the assessment has no field of its own.
  expect((await call('ORG_A_OWNER', 'PATCH', `/organizations/${a.id}/branding`, { industry: 'healthcare' })).status).toBe(200);
  expect((await call('ORG_B_OWNER', 'PATCH', `/organizations/${b.id}/branding`, { industry: 'legal', primary_color: '#3B2314', welcome_en: 'Welcome to Org B', welcome_ar: 'حيّاك في منشأة ب' })).status).toBe(200);

  // 15: each organization keeps its own, and neither leaks into the other.
  await owner.goto(experience('en', a, jobA));
  expect(await shown(owner)).toEqual([FILES.healthcare]);
  await ownerB.goto(experience('en', b, jobB));
  expect(await shown(ownerB)).toEqual([FILES.legal]);
  await expect(ownerB.getByText('Welcome to Org B')).toBeVisible();
  await owner.goto(experience('en', a, jobA));
  expect(await shown(owner)).toEqual([FILES.healthcare]);

  // Assessment override beats the organization default, in one organization.
  const marketing = await createAssessment('ORG_A_OWNER', a, 'marketing-role', 'marketing');
  await owner.goto(experience('en', a, marketing));
  expect(await shown(owner)).toEqual([ORIGINAL]);

  // 16: another organization can't read or change any of this.
  expect((await call('ORG_B_OWNER', 'PATCH', `/organizations/${a.id}/branding`, { industry: 'legal' })).status).toBe(403);
  expect((await call('ORG_A_OWNER', 'PATCH', `/organizations/${b.id}/branding`, { industry: 'finance' })).status).toBe(403);
  await ownerB.goto(experience('en', a, jobA));
  await expect(ownerB.getByRole('heading', { level: 1 })).toHaveText('This field is empty');
  await ownerB.goto(`/en/organization/${a.id}/settings`);
  await expect(ownerB.getByRole('heading', { level: 1 })).toHaveText('This field is empty');
  await owner.goto(experience('en', a, jobA));
  expect(await shown(owner)).toEqual([FILES.healthcare]);
});

test('settings screens save and update Humaidan for real, and a candidate sees it inside a live assessment', async ({ browser }) => {
  const org = await createOrg('ORG_A_OWNER', 'ui');
  const job = await createAssessment('ORG_A_OWNER', org, 'developer', null);
  const owner = await open(browser, 'ORG_A_OWNER', { viewport: { width: 1280, height: 900 } });

  await owner.goto(`/en/organization/${org.id}/settings`);
  await owner.getByLabel("Organization's field").selectOption('finance');
  expect(await shown(owner)).toEqual([FILES.finance]);
  await owner.getByLabel('Welcome message in English').fill('Welcome to our assessment.');
  await owner.locator('input[type=file][accept*="image/webp"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(owner.getByRole('img', { name: 'Logo' })).toBeVisible();
  await owner.getByLabel("Organization's field").selectOption('finance');
  await owner.getByRole('button', { name: 'Save identity' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/c-settings-en.png`, fullPage: true });

  await owner.goto(`/en/organization/${org.id}/jobs/${job.jobId}`);
  await owner.getByLabel("This assessment's professional field").selectOption('technology');
  await expect(owner.getByText('Saved', { exact: true })).toBeVisible();
  await expect(owner.getByRole('list', { name: "This job's path" })).toBeVisible();
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/c-workspace-en.png` });

  await owner.goto(experience('en', org, job));
  expect(await shown(owner)).toEqual([FILES.technology]);

  expect((await call('ORG_A_OWNER', 'POST', `/organizations/${org.id}/assessment-versions/${job.versionId}/publish`)).status).toBe(201);
  const application = await call('CANDIDATE_TWO', 'POST', `/jobs/${job.jobId}/applications`, {});
  expect(application.status).toBe(201);
  // Applying assigned the approved assessment.
  expect((await call('ORG_A_OWNER', 'POST', `/applications/${application.body.id}/invite`)).status).toBe(409);

  const candidate = await open(browser, 'CANDIDATE_TWO', { viewport: { width: 375, height: 812 } });
  await candidate.goto(experience('ar', org, job));
  expect(await shown(candidate)).toEqual([FILES.technology]);
  await expect(candidate.getByRole('img', { name: /./ }).first()).toBeVisible();
  const [scroll, inner] = await candidate.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/c-assessment-tech-ar-mobile.png`, fullPage: true });

  // Working through tasks doesn't bring in a different character.
  await candidate.getByRole('button', { name: 'ابدأ التقييم' }).click();
  await expect(candidate.getByRole('textbox')).toBeVisible();
  expect((await shown(candidate)).filter((f) => f !== FILES.technology)).toEqual([]);
});
