// Phase 3 in the browser: uploading job records, turning one into a job, search with pages, an employer claim, and team invitations.
// Fictional data on the local stack only. One fixture organization is marked real for the claim, which test organizations can't complete.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test, type Browser, type Page } from '@playwright/test';

const root = resolve(__dirname, '../../..');
const env: Record<string, string | undefined> = {};
for (const f of ['.env', '.env.test.local']) {
  if (existsSync(resolve(root, f))) Object.assign(env, parseEnv(readFileSync(resolve(root, f), 'utf8')));
}
const RUN = Date.now().toString(36);
const { Client } = createRequire(resolve(root, 'apps/api/package.json'))('pg') as typeof import('pg');

async function token(who: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

async function pageFor(browser: Browser, who: string, viewport = { width: 1280, height: 900 }) {
  const { access_token, refresh_token } = await token(who);
  const context = await browser.newContext({ viewport });
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

test('search reads the description and requirements, tolerates Arabic spelling, and splits results into pages', async ({ browser }) => {
  const org = (await call('ORG_A_OWNER', 'POST', '/organizations', { slug: `midan-test-browse-${RUN}`, name_ar: 'تصفح', name_en: `Midan Test Browse ${RUN}` })).id;
  const job = async (slug: string, title: string, details = {}) => {
    const { id } = await call('ORG_A_OWNER', 'POST', `/organizations/${org}/jobs`, { slug: `${slug}-${RUN}`, title_ar: title, title_en: title, status: 'published' });
    if (Object.keys(details).length) await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${id}`, details);
    return id;
  };
  await job('details', `تفاصيل${RUN}`, { description_ar: `إدارة الموارد البشرية ${RUN}`, requirements_en: `Knows payroll${RUN} well` });
  for (let i = 0; i < 14; i += 1) await job(`many-${i}`, `كثير${RUN} ${i}`);

  const page = await pageFor(browser, 'ORG_A_OWNER');
  await page.goto('/en/opportunities');
  await page.waitForLoadState('networkidle');
  const box = page.getByRole('searchbox');
  await box.fill(`payroll${RUN}`);
  await expect(page).toHaveURL(/q=payroll/);
  await expect(page.getByRole('link', { name: new RegExp(`تفاصيل${RUN}$`) })).toBeVisible();
  await expect(page.getByText('1 result', { exact: true })).toBeVisible();
  await box.fill(`ادارة الموارد ${RUN}`);
  await expect(page.getByRole('link', { name: new RegExp(`تفاصيل${RUN}$`) })).toBeVisible();

  await box.fill(`كثير${RUN}`);
  await expect(page.getByText('14 results')).toBeVisible();
  const pages = page.getByRole('navigation', { name: 'Pages of jobs' });
  await expect(pages.getByText('Page 1 of 2')).toBeVisible();
  await pages.getByRole('link', { name: 'Next' }).click();
  await expect(pages.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: `كثير${RUN}` })).toHaveCount(2);
  // The address holds the search, so it survives a reload and can be shared. A new search starts again from the first page.
  await page.reload();
  await expect(pages.getByText('Page 2 of 2')).toBeVisible();
  await expect(box).toHaveValue(`كثير${RUN}`);
  await box.fill(`كثير${RUN} 1`);
  await expect(page).not.toHaveURL(/page=2/);

  await page.goto(`/ar/opportunities?q=${encodeURIComponent(`كثير${RUN}`)}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('navigation', { name: 'صفحات الوظائف' }).getByRole('link', { name: 'التالي' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await noOverflow(page);
});

test('an administrator previews and saves a file, an organization proves it represents the employer, and a record becomes a job people can apply to', async ({ browser }) => {
  const superuser = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${env.DATABASE_URL?.match(/:(\d+)\//)?.[1] ?? 54322}/midan` });
  await superuser.connect();
  const [employer] = await call('CANDIDATE_ONE', 'GET', '/reference/employers?q=ALM-006');
  const org = (await call('ORG_A_OWNER', 'POST', '/organizations', { slug: `midan-test-records-${RUN}`, name_ar: 'سجلات', name_en: `Midan Test Records ${RUN}` })).id;
  const setTest = async (value: boolean) => {
    await superuser.query('begin');
    await superuser.query('set local session_replication_role = replica');
    await superuser.query('update public.organizations set is_test = $2 where id = $1', [org, value]);
    await superuser.query('commit');
  };
  const title = `مراجع توريد ${RUN}`;
  try {
    // The administrator uploads. Before saving, the screen shows what would happen, and nothing is saved.
    const admin = await pageFor(browser, 'PLATFORM_ADMIN');
    await admin.goto('/en/admin/listings');
    await admin.getByText('Upload job records (CSV or JSON)').click();
    await admin.getByLabel('Where they come from').selectOption('employer_provided');
    await admin.getByLabel('Source name').fill('Fictional source');
    await admin.getByLabel('What permits using these records').fill('Fictional records, for tests only');
    const csv = [
      'title,url,company,description,job_id,location',
      `${title},https://example.com/${RUN}/1,${employer.name_ar},يراجع عقود التوريد قبل توقيعها,midan-test-${RUN}-1,جدة`,
      `,https://example.com/${RUN}/2,${employer.name_ar},,midan-test-${RUN}-2,`,
    ].join('\n');
    await admin.getByLabel('File', { exact: true }).setInputFiles({ name: 'jobs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await admin.getByRole('button', { name: 'Preview' }).click();
    const preview = admin.getByTestId('listing-preview');
    await expect(preview.getByRole('status')).toHaveText('jobs.csv: 2 records');
    await expect(preview.getByText('No job title')).toBeVisible();
    await expect(preview.getByRole('row').filter({ hasText: title })).toContainText('New');
    await admin.reload();
    await expect(admin.getByRole('heading', { level: 2, name: title })).toHaveCount(0);

    await admin.getByText('Upload job records (CSV or JSON)').click();
    await admin.getByLabel('Source name').fill('Fictional source');
    await admin.getByLabel('What permits using these records').fill('Fictional records, for tests only');
    await admin.getByLabel('File', { exact: true }).setInputFiles({ name: 'jobs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await admin.getByRole('button', { name: 'Preview' }).click();
    await admin.getByRole('button', { name: 'Save these records' }).click();
    await expect(admin.getByText('Saved. Each record now waits for review below.')).toBeVisible();
    await admin.reload();
    const record = admin.getByRole('listitem').filter({ has: admin.getByRole('heading', { level: 2, name: title }) });
    await record.getByRole('button', { name: 'Approve', exact: false }).first().click();
    await expect(record.getByRole('button', { name: 'Create a draft job' })).toBeVisible();

    // Without an organization managing the employer, it can't become a job yet.
    await record.getByRole('button', { name: 'Create a draft job' }).click();
    await expect(record.getByRole('alert').or(record.getByText("This change isn't allowed.")).first()).toBeVisible();

    // The organization claims the employer, and gets nothing until a person approves.
    await setTest(false);
    const owner = await pageFor(browser, 'ORG_A_OWNER');
    await owner.goto(`/en/organization/${org}/settings`);
    await owner.getByLabel('Employer', { exact: true }).selectOption(employer.id);
    await owner.getByLabel('Your role there').fill('Fictional HR manager');
    await owner.getByLabel('How can we check this?').fill('A fictional letter, for tests only.');
    await owner.getByLabel('Supporting file (optional)', { exact: true }).setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfictional\n%%EOF') });
    await owner.getByRole('button', { name: 'Send the request' }).click();
    await expect(owner.getByText(/is being checked/)).toBeVisible();
    await owner.goto(`/en/organization/${org}`);
    await expect(owner.getByRole('heading', { name: 'Job records for your employer' })).toHaveCount(0);

    await admin.goto('/en/admin/claims');
    const claim = admin.getByRole('listitem').filter({ hasText: `Midan Test Records ${RUN}` });
    await expect(claim.getByText("Doesn't match the official website")).toBeVisible();
    await expect(claim.getByRole('button', { name: 'Open the evidence file' })).toBeVisible();
    await claim.getByRole('button', { name: 'Reject' }).click();
    await expect(claim.getByText('Complete the required fields.')).toBeVisible();
    await claim.getByRole('button', { name: 'Approve' }).click();
    await expect(claim.getByText('Approved')).toBeVisible();

    await owner.goto(`/en/organization/${org}/settings`);
    await expect(owner.getByText(/This organization manages/)).toBeVisible();
    await expect(owner.getByText("It doesn't make the employer a partner of Midan.")).toBeVisible();

    // The organization turns the record into a draft, reviews it, and publishes it. Approved listings sit on the Jobs page.
    await owner.goto(`/en/organization/${org}/jobs`);
    const row = owner.getByRole('listitem').filter({ hasText: title });
    await row.getByRole('button', { name: 'Create a draft job' }).click();
    await row.getByRole('link', { name: 'Open the job' }).click();
    await expect(owner).toHaveURL(new RegExp(`/organization/${org}/jobs/`));
    await expect(owner.getByRole('heading', { level: 1 })).toContainText(title);
    const job = owner.url().split('/jobs/')[1].split(/[?#]/)[0];
    await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/jobs/${job}/status`, { status: 'published' });

    // Anyone looking for what it says finds it, and can apply.
    const candidate = await pageFor(browser, 'CANDIDATE_ONE');
    await candidate.goto(`/ar/opportunities?q=${encodeURIComponent(`عقود التوريد ${RUN}`)}`);
    await candidate.getByRole('link', { name: new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
    await expect(candidate.getByRole('heading', { level: 1 })).toContainText(title);
    await expect(candidate.getByRole('link', { name: 'التقديم على هذه الوظيفة' }).or(candidate.getByRole('link', { name: /قدّم|التقديم/ })).first()).toBeVisible();
  } finally {
    await superuser.query('update public.organizations set employer_registry_id = null where id = $1', [org]);
    await setTest(true);
    await superuser.end();
  }
});

test('an owner invites a teammate, who accepts from their own account with the invited role', async ({ browser }) => {
  const org = (await call('ORG_B_OWNER', 'POST', '/organizations', { slug: `midan-test-team-${RUN}`, name_ar: `فريق ${RUN}`, name_en: `Midan Test Team ${RUN}` })).id;
  const owner = await pageFor(browser, 'ORG_B_OWNER');
  await owner.goto(`/en/organization/${org}/settings`);
  await owner.getByLabel('Email', { exact: true }).fill(env.TEST_ORG_A_RECRUITER_EMAIL as string);
  await owner.getByLabel('Role', { exact: true }).selectOption('reviewer');
  await owner.getByRole('button', { name: 'Send invitation' }).click();
  await expect(owner.getByText(`Invitation created for ${env.TEST_ORG_A_RECRUITER_EMAIL}.`)).toBeVisible();
  await expect(owner.getByRole('listitem').filter({ hasText: env.TEST_ORG_A_RECRUITER_EMAIL as string }).getByText(/Reviewer/)).toBeVisible();

  // It reaches only the invited account. Someone else sees nothing.
  const other = await pageFor(browser, 'CANDIDATE_TWO');
  await other.goto('/en/invitations');
  await expect(other.getByText('No invitations')).toBeVisible();

  const invited = await pageFor(browser, 'ORG_A_RECRUITER');
  await invited.goto('/ar/invitations');
  await expect(invited.locator('html')).toHaveAttribute('dir', 'rtl');
  const card = invited.getByRole('listitem').filter({ has: invited.getByRole('heading', { name: `فريق ${RUN}` }) });
  await expect(card).toBeVisible();
  await invited.setViewportSize({ width: 390, height: 800 });
  await noOverflow(invited);
  await card.getByRole('button', { name: 'قبول' }).click();
  await expect(invited).toHaveURL(new RegExp(`/ar/organization/${org}$`));

  await owner.reload();
  const member = owner.getByRole('listitem').filter({ hasText: env.TEST_ORG_A_RECRUITER_EMAIL as string });
  await expect(member.getByRole('combobox')).toHaveValue('reviewer');
  // An organization always keeps its owner: the last one isn't offered for removal.
  await expect(owner.getByRole('listitem').filter({ hasText: env.TEST_ORG_B_OWNER_EMAIL as string }).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await member.getByRole('combobox').selectOption('recruiter');
  await expect(member.getByRole('combobox')).toHaveValue('recruiter');
  await member.getByRole('button', { name: 'Remove' }).click();
  await expect(owner.getByRole('listitem').filter({ hasText: env.TEST_ORG_A_RECRUITER_EMAIL as string })).toHaveCount(0);
});
