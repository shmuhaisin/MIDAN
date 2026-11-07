// The employer's review of one applicant in the browser: the snapshot, evidence, a deliberate shortlist, a note, an
// interview with a chosen interviewer, and that interviewer's feedback; then the candidate's notification. Fictional
// data on the local stack only, in Arabic (RTL) and English (LTR), light and dark.
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

async function token(who: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { access_token: string; refresh_token: string; user: { id: string } };
}

async function pageFor(browser: Browser, who: string, options: { width?: number; colorScheme?: 'light' | 'dark' } = {}) {
  const { access_token, refresh_token } = await token(who);
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 }, colorScheme: options.colorScheme ?? 'light' });
  const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
  await context.addCookies([{ ...cookie, name: 'midan_at', value: access_token }, { ...cookie, name: 'midan_rt', value: refresh_token }]);
  return context.newPage();
}

const call = async (who: string, method: string, path: string, body?: unknown) => {
  const { access_token } = await token(who);
  const res = await fetch(`${env.API_URL}/v1${path}`, { method, headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  expect(res.ok, `${method} ${path} ${res.status}`).toBe(true);
  return res.json();
};

async function noOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

test('an employer reviews an applicant, shortlists on purpose, interviews with a colleague and records feedback', async ({ browser }) => {
  test.setTimeout(120_000);
  // Fictional setup through the API: an organization with a recruiter, a published job, and one application.
  const org = (await call('ORG_A_OWNER', 'POST', '/organizations', { slug: `midan-test-review-${RUN}`, name_ar: 'مراجعة', name_en: `Review org ${RUN}` })).id as string;
  await call('ORG_A_OWNER', 'POST', `/organizations/${org}/team/invitations`, { email: env.TEST_ORG_A_RECRUITER_EMAIL, role: 'recruiter' });
  const invitation = ((await call('ORG_A_RECRUITER', 'GET', '/me/invitations')) as { id: string; org_id: string }[]).find((i) => i.org_id === org)!;
  await call('ORG_A_RECRUITER', 'POST', `/me/invitations/${invitation.id}/accept`);
  const job = (await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs`, { slug: 'analyst', title_ar: `محلل تقارير ${RUN}`, title_en: `Reporting analyst ${RUN}`, status: 'published' })).id as string;
  const skill = ((await (await fetch(`${env.API_URL}/v1/skills`)).json()) as { id: string; slug: string }[]).find((s) => s.slug === 'data-analysis')!;
  await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${job}`, { skills: [{ skill_id: skill.id, required_level: 3 }] });
  await call('CANDIDATE_TWO', 'PUT', '/me/candidate-profile', { full_name: 'Test Candidate Two', headline: 'Fictional reporting analyst' });
  await call('CANDIDATE_TWO', 'PUT', '/me/skills', { skill_ids: [skill.id] });
  const application = (await call('CANDIDATE_TWO', 'POST', `/jobs/${job}/applications`, { cover_note: 'Fictional cover note.' })).id as string;
  const path = `/organization/${org}/applicants/${application}`;

  // Arabic first, right to left.
  const owner = await pageFor(browser, 'ORG_A_OWNER');
  await owner.goto(`/ar${path}`);
  await expect(owner.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(owner.getByRole('heading', { level: 1, name: 'Test Candidate Two' })).toBeVisible();
  await expect(owner.getByText('Fictional reporting analyst')).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'الأدلة على المهارات المطلوبة للوظيفة' })).toBeVisible();
  // Numbers follow the Arabic locale's digits.
  await expect(owner.getByText(/^(1|١) من (1|١) مهارات مطلوبة لها دليل$/)).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'سجل الحالة' })).toBeVisible();

  // English, and a deliberate shortlist.
  await owner.goto(`/en${path}`);
  await owner.waitForLoadState('networkidle');
  await expect(owner.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(owner.getByText("This isn't a score, a ranking or a prediction.", { exact: false })).toBeVisible();
  await owner.getByRole('combobox', { name: 'Application status' }).selectOption('shortlisted');
  await expect.poll(async () => (await call('CANDIDATE_TWO', 'GET', `/me/applications/${application}`)).status).toBe('shortlisted');

  // A note, kept as written.
  await owner.getByLabel('Add a note').fill('Strong reporting examples (fictional).');
  await owner.getByRole('button', { name: 'Add note' }).click();
  await expect(owner.getByText('Strong reporting examples (fictional).')).toBeVisible();

  // An interview with a chosen colleague.
  const when = new Date(Date.now() + 2 * 3600_000);
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await owner.locator('input[name="when"]').fill(local);
  await owner.getByRole('group', { name: 'Interviewers' }).getByRole('checkbox').first().check();
  await owner.getByRole('button', { name: 'Schedule an interview' }).click();
  await expect(owner.getByRole('heading', { name: 'Interview feedback' })).toBeVisible();
  await expect(owner.getByText(/Taking part:/)).toContainText('Midan test: org-a-recruiter');
  await expect(owner.getByText(/Taking part:/)).toContainText('Midan test: org-a-owner');

  // The interviewer's own feedback: rated, recommended, submitted.
  await owner.getByRole('group', { name: 'Competency 1' }).getByLabel('Rating').selectOption('3');
  await owner.getByRole('group', { name: 'Competency 1' }).getByLabel('What showed it').fill('Walked through a monthly report.');
  await owner.getByLabel('Your recommendation').selectOption('yes');
  await owner.getByRole('button', { name: 'Submit feedback' }).click();
  await expect(owner.getByText('Feedback submitted')).toBeVisible();
  await owner.reload();
  await expect(owner.getByText(/Recommend$/).first()).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Submit feedback' })).toHaveCount(0);

  // The decision is still the organization's: nothing changed on its own.
  expect((await call('CANDIDATE_TWO', 'GET', `/me/applications/${application}`)).status).toBe('shortlisted');

  // Phone width, dark theme, no overflow.
  const narrow = await pageFor(browser, 'ORG_A_OWNER', { width: 390, colorScheme: 'dark' });
  await narrow.goto(`/ar${path}`);
  await expect(narrow.getByRole('heading', { level: 1 })).toBeVisible();
  await noOverflow(narrow);

  // The candidate is told, in the app, and never sees the organization's notes or feedback.
  const candidate = await pageFor(browser, 'CANDIDATE_TWO');
  await candidate.goto('/en/notifications');
  await expect(candidate.getByText(`You've been shortlisted for Reporting analyst ${RUN}`)).toBeVisible();
  await candidate.goto(`/en/applications/${application}`);
  await expect(candidate.getByText('Strong reporting examples (fictional).')).toHaveCount(0);
  await expect(candidate.getByText('Walked through a monthly report.')).toHaveCount(0);
});
