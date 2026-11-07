// The whole candidate journey in a browser, against the real database and API. Every person and CV here is fictional.
// Video and calendar credentials aren't configured in this environment, so those screens are checked for saying so.
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
const NOT_FOUND = JSON.parse(readFileSync(resolve(__dirname, '../src/messages/en.json'), 'utf8')).notFound.title;

async function session(who: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  return res.json() as Promise<{ access_token: string; refresh_token: string }>;
}

async function pageFor(browser: Browser, tokens: { access_token: string; refresh_token: string }, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
  await context.addCookies([{ ...cookie, name: 'midan_at', value: tokens.access_token }, { ...cookie, name: 'midan_rt', value: tokens.refresh_token }]);
  return context.newPage();
}

function docx(lines: string[]) {
  const crc32 = (data: Buffer) => { let c = ~0; for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const body = Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  const name = Buffer.from('word/document.xml');
  const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc32(body), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(body.length, 22); head.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc32(body), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const offset = head.length + name.length + body.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([head, name, body, central, name, end]);
}

async function noOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

test('registration data to career development: the whole candidate journey', async ({ browser }) => {
  test.setTimeout(420_000);
  const ownerTokens = await session('ORG_A_OWNER');
  const candidateTokens = await session('CANDIDATE_ONE');
  const call = async (method: string, path: string, body?: unknown, tokens = ownerTokens) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${tokens.access_token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.ok, `${method} ${path} answered ${res.status}`).toBe(true);
    return res.json();
  };

  // The organization side, set up through its API: a published job with an approved, deadlined assessment.
  const name = `Journey Analyst ${RUN}`;
  const org = await call('POST', '/organizations', { slug: `midan-test-journey-${RUN}`, name_ar: 'منشأة الرحلة', name_en: `Midan Test Journey ${RUN}` });
  const job = await call('POST', `/organizations/${org.id}/jobs`, { slug: `journey-${RUN}`, title_ar: `محلل الرحلة ${RUN}`, title_en: name, status: 'published' });
  await call('PATCH', `/organizations/${org.id}/jobs/${job.id}`, { sector: 'digital', experience_level: 'mid', employment_type: 'full_time', location: 'Riyadh', salary_min: 8000, salary_max: 12000, application_deadline: '2030-01-31' });
  const skills = await call('GET', '/skills');
  await call('PATCH', `/organizations/${org.id}/jobs/${job.id}`, { skills: [{ skill_id: skills[0].id, required_level: 3 }] }).catch(() => undefined);
  const draft = await call('POST', `/organizations/${org.id}/jobs/${job.id}/assessment/generate`, {});
  await call('PATCH', `/organizations/${org.id}/assessment-versions/${draft.version_id}`, { deadline_hours: 72, rubric_shared: true, scenario_en: 'You join a fictional analytics team.', scenario_ar: 'تنضم إلى فريق تحليل خيالي.' });
  // The scenario edit above is a change to MIDAN's draft, so approving it records a review of the changes, as the screen does.
  const changes = await call('GET', `/organizations/${org.id}/assessment-versions/${draft.version_id}/changes`);
  await call('POST', `/organizations/${org.id}/assessment-versions/${draft.version_id}/publish`, { reviewed_through: changes.latest_change_id });

  const candidate = await pageFor(browser, candidateTokens);
  const owner = await pageFor(browser, ownerTokens);
  const problems: string[] = [];
  candidate.on('pageerror', (e) => problems.push(e.message));
  owner.on('pageerror', (e) => problems.push(e.message));

  // Onboarding: the same page resumes, and each step saves.
  await candidate.goto('/en/onboarding?step=1');
  await expect(candidate.locator('img[src*="midan-logo"]')).toHaveCount(1);
  await candidate.getByLabel('Full name').fill('Journey Candidate');
  await candidate.getByLabel('Mobile number').fill('0551112222');
  await candidate.getByRole('button', { name: 'Next' }).click();
  await expect(candidate).toHaveURL(/step=2/);
  await expect(candidate.getByText('the file itself is never sent')).toBeVisible();

  // A failed analysis explains itself and offers a way forward.
  await candidate.locator('input[type=file]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictional and broken') });
  await expect(candidate.getByRole('alert').filter({ hasText: "couldn't be read" })).toBeVisible({ timeout: 30_000 });
  await expect(candidate.getByRole('button', { name: 'Try again' })).toBeVisible();

  // A good one waits for review. Its file name holds a name, and that isn't kept.
  await candidate.locator('input[type=file]').setInputFiles({
    name: 'journey-candidate-cv.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx(['Journey Candidate', 'journey.candidate@example.com', '+966 55 987 6543', 'National ID: 1098765432', 'Summary', 'Analyst who builds weekly reports for fictional teams', 'Skills', 'SQL, Python', 'الشهادات', 'شهادة بيانات خيالية', 'References', 'Noura Refname 0501112222']),
  });
  await candidate.getByRole('link', { name: 'Review what we read' }).click({ timeout: 40_000 });
  await expect(candidate.getByRole('heading', { level: 1 })).toHaveText('Review what we read from your CV');
  await expect(candidate.getByText('Local reading only')).toBeVisible();
  await expect(candidate.getByText(/personal items were removed/)).toBeVisible();
  await expect(candidate.getByText('Noura')).toHaveCount(0);
  await expect(candidate.locator('body')).not.toContainText('1098765432');
  // The name already filled in isn't replaced unless the candidate asks.
  await expect(candidate.getByRole('checkbox', { name: 'Use Name' })).not.toBeChecked();
  await candidate.getByRole('button', { name: 'Save what I chose' }).click();
  await expect(candidate).toHaveURL(/\/en\/profile$/);
  await expect(candidate.getByLabel('Full name')).toHaveValue('Journey Candidate');
  await expect(candidate.getByRole('heading', { name: 'Your skills', exact: true })).toBeVisible();
  await expect(candidate.getByRole('heading', { name: 'Skills from your CV' })).toBeVisible();
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/profile.png`, fullPage: true });

  await candidate.goto('/en/onboarding?step=3');
  // Suggestions from the reviewed CV arrive here, and search tolerates spelling differences.
  await candidate.getByRole('searchbox', { name: 'Search for a skill' }).fill('اداره المشاريع');
  await candidate.getByRole('button', { name: /إدارة/ }).first().click({ timeout: 20_000 });
  await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
  await candidate.getByRole('searchbox', { name: 'Search for a skill' }).fill(`Own skill ${RUN}`);
  await candidate.getByRole('button', { name: `Add "Own skill ${RUN}" as you wrote it` }).click({ timeout: 20_000 });
  await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
  await candidate.reload();
  await expect(candidate.getByRole('heading', { name: /Your skills \(\d+\)/ })).not.toHaveText('Your skills (0)');
  await expect(candidate.getByText(`Own skill ${RUN}`)).toBeVisible();
  await candidate.getByRole('button', { name: 'Next' }).click();
  await expect(candidate).toHaveURL(/step=4/);
  await candidate.getByRole('button', { name: 'Browse opportunities' }).click();
  await expect(candidate).toHaveURL(/\/en\/opportunities$/);

  // Discovery.
  await candidate.getByLabel('Sector').selectOption('digital');
  await candidate.getByLabel('Experience level').selectOption('mid');
  await candidate.getByRole('link', { name: name, exact: true }).click();
  await expect(candidate.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(candidate.getByRole('heading', { name: 'Practical assessment' })).toBeVisible();
  await expect(candidate.getByText(/Salary:/)).toBeVisible();
  await expect(candidate.getByText(/Apply by/)).toBeVisible();
  await expect(candidate.locator('body')).not.toContainText('fictional analytics team');

  // Applying, with a review first.
  await candidate.getByRole('link', { name: 'Apply for this job' }).click();
  await expect(candidate.getByText('Review your details')).toBeVisible();
  await expect(candidate.getByText('0551112222')).toBeVisible();
  await candidate.getByRole('button', { name: 'Confirm application' }).dblclick();
  await expect(candidate).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}\?new=1$/);
  const applicationPath = new URL(candidate.url()).pathname;
  const applicationId = applicationPath.split('/').pop() as string;
  await expect(candidate.getByRole('status').filter({ hasText: 'Your application was sent' })).toBeVisible();
  await expect(candidate.getByText('Submit by')).toBeVisible();
  await expect(candidate.getByRole('button', { name: 'Open the attached CV' })).toBeVisible();
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/application.png`, fullPage: true });

  // Coming back to the job doesn't offer a second application.
  await candidate.goto(`/en/opportunities/${job.id}/apply`);
  await expect(candidate).toHaveURL(new RegExp(`${applicationPath}$`));

  // The assessment: scenario, shared rubric, drafts that survive, and a receipt.
  await candidate.getByRole('link', { name: 'Start the assessment' }).click();
  await expect(candidate.getByText('You join a fictional analytics team.')).toBeVisible();
  await expect(candidate.getByText(/Deadline:/)).toBeVisible();
  await candidate.getByText("How it's assessed").click();
  await candidate.getByRole('button', { name: 'Start the assessment' }).click();
  const answer = 'I would compare the regions first, then check the change monthly and report what moved.';
  const box = () => candidate.getByRole('textbox', { name: 'Your answer' });
  await expect(box()).toBeVisible();
  await box().fill(answer);
  await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
  await candidate.reload();
  await expect(box()).toHaveValue(answer);
  for (let i = 0; i < 6; i++) {
    if (await box().isVisible()) {
      if (!(await box().inputValue())) {
        await box().fill(answer);
        await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
      }
    } else {
      await candidate.getByRole('radio', { name: 'Check its impact' }).check();
      await candidate.getByRole('radio', { name: 'Say what I know' }).check();
      await expect(candidate.getByText('Saved', { exact: true })).toBeVisible();
    }
    const next = candidate.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.isVisible())) break;
    await next.click();
  }
  await candidate.getByRole('button', { name: 'Review and submit' }).last().click();
  await candidate.getByRole('button', { name: 'Submit for good' }).click();
  await expect(candidate.getByText('Your work is in')).toBeVisible();
  await expect(candidate.getByRole('status').filter({ hasText: 'Submission receipt MDN-' })).toBeVisible({ timeout: 20_000 });

  // The organization reviews and releases. A person decides.
  const mine = await call('GET', `/me/applications/${applicationId}`, undefined, candidateTokens);
  const attempt = mine.assessment_attempts[0].id;
  const evaluation = await call('POST', `/attempts/${attempt}/evaluate`);
  await call('POST', `/evaluations/${evaluation.id}/review`, { scores: [], notes: 'INTERNAL-BROWSER-NOTE' });
  await call('POST', `/evaluations/${evaluation.id}/release`);

  await candidate.goto('/en/notifications');
  await expect(candidate.getByText(new RegExp(`Results are out for ${name}`))).toBeVisible();
  await candidate.getByRole('button', { name: new RegExp(`Results are out for ${name}`) }).click();
  await expect(candidate).toHaveURL(new RegExp(`/en/reports/${attempt}$`));
  await expect(candidate.getByRole('heading', { name: 'Results by criterion' })).toBeVisible();
  await expect(candidate.locator('body')).not.toContainText('INTERNAL-BROWSER-NOTE');
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/report.png`, fullPage: true });

  // An interview scheduled by a person at the organization.
  await owner.goto(`/en/organization/${org.id}/applicants/${applicationId}`);
  const soon = new Date(Date.now() + 10 * 60_000);
  const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await owner.getByLabel('When').fill(local);
  await owner.getByLabel('Instructions in English').fill('Bring an example of your work.');
  await owner.getByRole('button', { name: 'Schedule an interview' }).click();
  await expect(owner.getByText("Not sent: the calendar isn't switched on")).toBeVisible();

  await candidate.goto(applicationPath);
  await candidate.getByRole('link', { name: 'Interview details' }).click();
  await expect(candidate.getByText('Bring an example of your work.')).toBeVisible();
  await expect(candidate.getByText("Not sent: the calendar isn't switched on")).toBeVisible();
  await expect(candidate.getByText('Accept the time first')).toHaveCount(0);
  await expect(candidate.getByText("Video calling isn't switched on")).toBeVisible();
  // Asking for another time keeps the appointment, and the organization's new time asks again.
  await candidate.getByRole('button', { name: 'Ask for another time' }).click();
  await candidate.getByLabel('Which times suit you?').fill('Any morning next week');
  await candidate.getByRole('button', { name: 'Send request' }).click();
  await expect(candidate.getByRole('status').filter({ hasText: 'The current appointment stands' })).toBeVisible();
  await owner.reload();
  await expect(owner.getByText('Any morning next week')).toBeVisible();
  await owner.getByRole('button', { name: 'Interview took place' }).click();
  await expect(owner.getByRole('button', { name: 'Interview took place' })).toHaveCount(0);
  await candidate.reload();
  await expect(candidate.getByText('Completed').first()).toBeVisible();
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/interview.png`, fullPage: true });

  // The decision comes from the organization, in its own words.
  await owner.getByRole('combobox', { name: 'Decision' }).selectOption('not_selected');
  await owner.getByLabel('Message to the candidate in English').fill('Thank you for your time.');
  await owner.getByRole('button', { name: 'Issue the decision' }).click();
  await expect(owner.getByText('Thank you for your time.')).toBeVisible();
  await candidate.goto(applicationPath);
  await expect(candidate.getByRole('heading', { name: "The organization's decision" })).toBeVisible();
  await expect(candidate.getByText('Not selected', { exact: false }).first()).toBeVisible();
  await expect(candidate.getByText('Thank you for your time.')).toBeVisible();

  // Development stays available whatever the outcome.
  await candidate.getByRole('link', { name: 'See career development' }).click();
  await expect(candidate.getByRole('heading', { level: 1 })).toHaveText('Career development');
  await candidate.getByLabel('Sector').selectOption('digital');
  await candidate.getByLabel('Job family').selectOption({ index: 1 });
  await candidate.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(candidate.getByRole('heading', { name: 'Skills for this role' })).toBeVisible();
  await expect(candidate.getByText("There's no verified catalog")).toBeVisible();
  await expect(candidate.getByText("nothing in your profile or assessments shows it yet").first()).toBeVisible();
  await candidate.getByRole('button', { name: 'Save as a goal' }).first().click();
  const progress = candidate.getByRole('combobox', { name: /^Progress:/ }).first();
  await expect(progress).toBeVisible();
  await Promise.all([candidate.waitForResponse((r) => r.request().method() === 'POST'), progress.selectOption('completed')]);
  await candidate.reload();
  await expect(candidate.getByRole('combobox', { name: /^Progress:/ }).first()).toHaveValue('completed');
  await expect(candidate.getByText("doesn't verify a certificate")).toBeVisible();
  if (SHOTS) await candidate.screenshot({ path: `${SHOTS}/development.png`, fullPage: true });

  // Dashboard, in Arabic, on a phone, with the logo and no sideways scroll on any candidate page.
  const phone = await pageFor(browser, candidateTokens, { width: 390, height: 844 });
  phone.on('pageerror', (e) => problems.push(e.message));
  for (const path of ['/ar/dashboard', '/ar/profile', '/ar/opportunities', `/ar/applications/${applicationId}`, '/ar/development', '/ar/notifications', '/ar/settings', '/ar/onboarding?step=2']) {
    await phone.goto(path);
    await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(phone.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(phone.locator('img[src*="midan-logo"]').first()).toBeVisible();
    await noOverflow(phone);
  }
  if (SHOTS) {
    await phone.goto('/ar/dashboard');
    await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
    await phone.screenshot({ path: `${SHOTS}/dashboard-ar-phone.png`, fullPage: true });
    await candidate.goto('/ar/dashboard');
    await expect(candidate.getByRole('heading', { level: 1 })).toBeVisible();
    await candidate.screenshot({ path: `${SHOTS}/dashboard-ar.png`, fullPage: true });
  }
  expect(problems).toEqual([]);
});

test('another candidate cannot open what belongs to someone else', async ({ browser }) => {
  const ownerTokens = await session('ORG_A_OWNER');
  const first = await session('CANDIDATE_ONE');
  const second = await session('CANDIDATE_TWO');
  const call = async (method: string, path: string, body?: unknown, tokens = ownerTokens) => {
    const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${tokens.access_token}`, ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(res.ok, `${method} ${path} answered ${res.status}`).toBe(true);
    return res.json();
  };
  const org = await call('POST', '/organizations', { slug: `midan-test-private-${RUN}`, name_ar: 'منشأة', name_en: `Midan Test Private ${RUN}` });
  const job = await call('POST', `/organizations/${org.id}/jobs`, { slug: `private-${RUN}`, title_ar: 'خاص', title_en: 'Private', status: 'published' });
  await call('PUT', '/me/candidate-profile', { full_name: 'Private Candidate' }, first);
  const application = await call('POST', `/jobs/${job.id}/applications`, {}, first);
  const interview = await call('POST', `/organizations/${org.id}/applications/${application.id}/interviews`, { scheduled_at: new Date(Date.now() + 3_600_000).toISOString() });

  const stranger = await pageFor(browser, second);
  for (const path of [`/en/applications/${application.id}`, `/en/interviews/${interview.id}`]) {
    // The loading screen means headers go out before the answer, so what counts is what the page shows.
    await stranger.goto(path);
    await expect(stranger.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND);
    await expect(stranger.locator('main')).not.toContainText('Private Candidate');
    await expect(stranger.locator('main')).not.toContainText('Midan Test Private');
  }
  const signedOut = await (await browser.newContext()).newPage();
  await signedOut.goto(`/en/interviews/${interview.id}`);
  await expect(signedOut).toHaveURL(new RegExp(`/en/login\\?next=.*${interview.id}`));
});

test('normal views hold no test records, and an empty list is truthful', async ({ browser }) => {
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await visitor.goto('/ar/opportunities');
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
  const text = await visitor.locator('main').innerText();
  for (const fixture of ['منشأة اختبار', 'منشأة ui', 'switch-a', 'switch-b', 'multi', 'no-field', 'marketing-role', 'تجريبية']) expect(text).not.toContain(fixture);
  await expect(visitor.getByText('لا توجد وظائف منشورة الآن')).toBeVisible();
  if (SHOTS) await visitor.screenshot({ path: `${SHOTS}/jobs-empty-ar.png` });

  await visitor.getByRole('link', { name: 'دليل جهات التوظيف' }).first().click();
  await expect(visitor).toHaveURL(/\/ar\/employers$/);
  await expect(visitor.getByRole('heading', { name: 'وزارة التجارة' })).toBeVisible();
  await expect(visitor.getByRole('listitem').filter({ has: visitor.getByRole('heading', { level: 2 }) })).toHaveCount(10);
  if (SHOTS) await visitor.screenshot({ path: `${SHOTS}/employers-ar.png`, fullPage: true });

  // Search by an alias finds the entity and says it matched an alias, not the official name.
  await visitor.getByRole('searchbox').or(visitor.getByLabel('ابحث في جهات العمل')).first().fill('سدايا');
  await visitor.getByRole('button', { name: 'بحث' }).click();
  await expect(visitor.getByText('يطابق الاسم «سدايا» (اسم متداول)')).toBeVisible();
  await visitor.getByRole('link', { name: 'عرض الملف' }).click();
  await expect(visitor.getByRole('heading', { level: 1 })).toContainText('سدايا');
  await expect(visitor.getByText('ليست شريكًا لميدان').first()).toBeVisible();
  await expect(visitor.getByText(/هوية ميدان المحايدة/)).toBeVisible();
  await expect(visitor.getByText(/ALMIDAN_Employer_Database_10_Entities\.xlsx/)).toBeVisible();

  await visitor.goto('/ar/opportunities?demo=1');
  await expect(visitor.getByText('وظائف توضيحية')).toBeVisible();
  await expect(visitor.getByRole('link', { name: /محلل بيانات/ }).first()).toBeVisible();
  if (SHOTS) await visitor.screenshot({ path: `${SHOTS}/jobs-demo-ar.png` });

  // Scrolled to the bottom and back, nothing sits under the sticky header.
  await visitor.goto('/ar/login');
  const header = await visitor.locator('header').first().boundingBox();
  const title = await visitor.getByRole('heading', { level: 1 }).boundingBox();
  expect((title?.y ?? 0)).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
  const size = await visitor.getByRole('heading', { level: 1 }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeLessThanOrEqual(32);
  await expect(visitor.locator('img[src*="midan-logo"]')).toHaveCount(1);
  if (SHOTS) await visitor.screenshot({ path: `${SHOTS}/login-ar.png` });
});

test('a new candidate with nothing yet: dashboard, skills and empty states', async ({ browser }) => {
  const tokens = await session('CANDIDATE_TWO');
  const page = await pageFor(browser, tokens);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/ar/onboarding?step=1');
  await page.getByLabel('الاسم الكامل').fill('مرشح خيالي');
  await page.getByRole('button', { name: 'التالي' }).click();
  await expect(page).toHaveURL(/step=2/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onboarding-cv-ar.png`, fullPage: true });
  await page.goto('/ar/onboarding?step=3');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مهاراتك');
  await expect(page.getByText('راجع مهاراتك وأضف ما ينقصها.')).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'ابحث عن مهارة' });
  await search.fill('اداره المشاريع');
  await expect(page.getByRole('button', { name: /إدارة المشاريع/ }).first()).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/skills-search-ar.png`, fullPage: true });
  await page.getByRole('button', { name: /إدارة المشاريع/ }).first().click();
  await expect(page.getByText('تم الحفظ')).toBeVisible();
  await search.fill('لا توجد مهارة بهذا الاسم أبدا');
  await expect(page.getByText('لا توجد نتائج مطابقة.')).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: /مهاراتك \(/ })).not.toHaveText('مهاراتك (0)');
  await expect(page.getByRole('button', { name: 'إزالة إدارة المشاريع' }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/skills-saved-ar.png`, fullPage: true });
  await page.goto('/ar/dashboard');
  await expect(page.getByRole('navigation', { name: 'حسابي' }).getByRole('link', { name: 'لوحتي' })).toHaveAttribute('aria-current', 'page');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-new-ar.png`, fullPage: true });
  const phone = await pageFor(browser, tokens, { width: 390, height: 844 });
  for (const path of ['/ar/onboarding?step=3', '/ar/dashboard', '/ar/opportunities', '/ar/employers']) {
    await phone.goto(path);
    await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
    await noOverflow(phone);
  }
  if (SHOTS) {
    await phone.goto('/ar/onboarding?step=3');
    await expect(phone.getByRole('heading', { level: 1 })).toHaveText('مهاراتك');
    await phone.screenshot({ path: `${SHOTS}/skills-phone-ar.png`, fullPage: true });
  }
  expect(problems).toEqual([]);
});
