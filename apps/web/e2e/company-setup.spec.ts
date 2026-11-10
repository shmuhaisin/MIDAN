// The company representative's path through the real UI, for two companies with different logos: registration, the
// emailed confirmation link, a MIDAN administrator's approval, then the guided setup (details, logo and identity, team).
// It checks that every Save moves on by itself, that a missing field is explained in place, that the colours read from
// each logo theme only that company's workspace in light and dark, and that neither company can open the other's.
// The logos are drawn here; they are test images, not any company's real logo. Every person here is fictional.
//
//   SHOTS=1 npx playwright test e2e/company-setup.spec.ts      (screenshots into .local/evidence/company-setup/)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';

const root = resolve(__dirname, '../../..');
const env: Record<string, string | undefined> = {};
for (const f of ['.env', '.env.test.local']) if (existsSync(resolve(root, f))) Object.assign(env, parseEnv(readFileSync(resolve(root, f), 'utf8')));
const API = `${env.API_URL ?? 'http://localhost:4000'}/v1`;
const RUN = Date.now().toString(36);
const SHOTS = process.env.SHOTS ? resolve(root, '.local/evidence/company-setup') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** A logo with a white box behind it, the case MIDAN must not mistake for the brand colour. */
async function logo(svg: string) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#ffffff"/>${svg}</svg>`)).png().toBuffer();
}

async function token(email: string, password: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()).access_token as string;
}

const call = async (tok: string, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const rgbHex = (rgb: string) => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

type Company = { employer: RegExp; slug: string; logo: Buffer; industry: string; welcomeEn: string; welcomeAr: string };

/** Registers a representative through the form, confirms the email, has an administrator approve, and signs in. */
async function representative(browser: Browser, company: Company) {
  const email = `fictional.rep.${company.slug}.${RUN}@example.com`;
  const password = `Setup-${RUN}-${company.slug}!`;
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en' });
  const page = await context.newPage();
  await page.goto('/en/register?as=organization');
  const option = (await page.locator('select[name=registry_id] option').allTextContents()).find((o) => company.employer.test(o));
  expect(option, 'the employer is offered').toBeTruthy();
  await page.selectOption('select[name=registry_id]', { label: option! });
  await page.fill('input[name=display_name]', `Fictional ${company.slug} representative`);
  await page.fill('input[name=job_title]', 'Talent Acquisition Lead');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/check-email/, { timeout: 20_000 });

  let link: string | undefined;
  for (let i = 0; i < 60 && !link; i++) {
    const mail = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/__mail?to=${encodeURIComponent(email)}`)).json();
    link = mail[0]?.links.find((l: string) => l.includes('/verify'));
    if (!link) await page.waitForTimeout(250);
  }
  expect(link, 'confirmation email').toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/organization\/new/, { timeout: 20_000 });
  await expect(page.getByRole('status')).toBeVisible(); // waiting for a MIDAN administrator

  const admin = await token(env.TEST_PLATFORM_ADMIN_EMAIL as string, env.TEST_PLATFORM_ADMIN_PASSWORD as string);
  const queue = await call(admin, 'GET', '/admin/employer-access');
  const request = (queue.body as { id: string; work_email: string }[]).find((r) => r.work_email === email);
  expect(request, 'access request').toBeTruthy();
  // Owner, so this run can set up the workspace even if an earlier run already created it for this employer.
  expect((await call(admin, 'POST', `/admin/employer-access/${request!.id}/decision`, { decision: 'approve', role: 'owner' })).status).toBe(201);
  return { page, email, password, tok: await token(email, password) };
}

async function setUp(page: Page, company: Company, label: string) {
  await page.goto('/en/organization/new');
  await expect(page).toHaveURL(/organization\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const orgId = page.url().match(/organization\/([0-9a-f-]{36})/)![1];
  await page.goto(`/en/organization/${orgId}/setup?step=1`);
  await shot(page, `${label}-1-details-empty`);

  // A missing field is explained where it is; nothing is sent.
  await page.selectOption('select[name=industry]', { index: 0 }).catch(() => {});
  await page.evaluate(() => { const s = document.querySelector<HTMLSelectElement>('select[name=industry]'); if (s) { s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Choose your field to continue.')).toBeVisible();
  await expect(page).toHaveURL(/step=1/);

  await page.selectOption('select[name=industry]', company.industry);
  await page.selectOption('select[name=company_type]', 'large_enterprise');
  await page.fill('textarea[name=welcome_en]', company.welcomeEn);
  await page.fill('textarea[name=welcome_ar]', company.welcomeAr);
  const saved = Date.now();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // Save moves on by itself.
  await expect(page).toHaveURL(/setup\?step=2/, { timeout: 20_000 });
  const savedIn = Date.now() - saved;

  await shot(page, `${label}-2-identity-empty`);
  await page.setInputFiles('input[type=file]', { name: `${company.slug}-logo.png`, mimeType: 'image/png', buffer: company.logo });
  // While the logo is read, nothing can be approved; then the new identity appears as a suggestion.
  await expect(page.getByText('Reading the colours of your logo…')).toBeVisible();
  await expect(page.getByText('Suggested — not applied yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Identity read from your logo' })).toBeVisible();
  await expect(page.getByText(/The background behind the logo \(#ffffff\) was ignored/)).toBeVisible();
  await shot(page, `${label}-2-identity-suggested`);
  await page.getByRole('button', { name: 'Use this identity and continue' }).click();
  await expect(page).toHaveURL(/setup\?step=3/, { timeout: 20_000 });
  await shot(page, `${label}-3-team`);
  await page.getByRole('link', { name: 'Finish and open the workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`organization/${orgId}\\?setup=done`));
  return { orgId, savedIn };
}

test('two companies set up their workspaces, each in the identity read from its own logo', async ({ browser }) => {
  test.setTimeout(420_000);
  const purple: Company = {
    employer: /stc/i, slug: 'telecom',
    logo: await logo('<rect x="40" y="70" width="240" height="100" rx="8" fill="#4f008c"/><circle cx="380" cy="120" r="48" fill="#ff375e"/>'),
    industry: 'technology', welcomeEn: 'Welcome. This assessment reflects real work in our network and customer teams.', welcomeAr: 'مرحبًا بك. يعكس هذا التقييم عملًا حقيقيًا في فرق الشبكات وخدمة العملاء لدينا.',
  };
  const blue: Company = {
    employer: /elm/i, slug: 'digital',
    logo: await logo('<rect x="40" y="60" width="300" height="120" rx="60" fill="#0b5fff"/><rect x="360" y="90" width="80" height="60" fill="#f5a300"/>'),
    industry: 'technology', welcomeEn: 'Welcome to our digital solutions team.', welcomeAr: 'مرحبًا بك في فريق الحلول الرقمية.',
  };

  const a = await representative(browser, purple);
  const b = await representative(browser, blue);
  const setA = await setUp(a.page, purple, 'telecom');
  const setB = await setUp(b.page, blue, 'digital');
  expect(setA.savedIn).toBeLessThan(15_000);

  // The identity was read from the logo, not the white box, and approved.
  const orgA = (await call(a.tok, 'GET', `/organizations/${setA.orgId}`)).body;
  const orgB = (await call(b.tok, 'GET', `/organizations/${setB.orgId}`)).body;
  expect(orgA.branding.palette_status).toBe('approved');
  expect(orgA.branding.palette.background).toBe('#ffffff');
  expect(orgA.branding.primary_color).not.toBe('#ffffff');
  expect(orgB.branding.palette_status).toBe('approved');

  // Each workspace wears its own colours, in light and in dark; MIDAN's own header doesn't change.
  for (const [rep, org, label] of [[a, orgA, 'telecom'], [b, orgB, 'digital']] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await rep.page.evaluate((t) => localStorage.setItem('theme', t), theme);
      await rep.page.goto(`/en/organization/${org.id}`, { waitUntil: 'networkidle' });
      await expect(rep.page.locator('html')).toHaveAttribute('data-theme', theme);
      const workspace = rep.page.locator(`[data-org-workspace="${org.id}"]`).first();
      await expect(workspace).toHaveClass(/org-themed/);
      const button = workspace.locator('.btn-primary').first();
      await expect(button).toBeVisible();
      const bg = rgbHex(await button.evaluate((el) => getComputedStyle(el).backgroundColor));
      expect(bg, `${label} ${theme} button`).toBe(org.branding.palette[theme].primary);
      const header = rgbHex(await rep.page.locator('header').first().evaluate((el) => getComputedStyle(el.querySelector('.btn-primary') ?? el).backgroundColor));
      expect(header).not.toBe(org.branding.palette[theme].primary);
      await shot(rep.page, `${label}-workspace-${theme}`);
    }
  }
  expect(orgA.branding.palette.light.primary).not.toBe(orgB.branding.palette.light.primary);

  // Neither company can open the other's workspace, through the API or the page.
  expect([403, 404]).toContain((await call(a.tok, 'GET', `/organizations/${setB.orgId}`)).status);
  expect((await call(b.tok, 'POST', `/organizations/${setA.orgId}/branding/palette/approve`, {})).status).toBeGreaterThanOrEqual(403);
  await a.page.goto(`/en/organization/${setB.orgId}/setup`);
  await expect(a.page.locator(`[data-org-workspace="${setB.orgId}"]`)).toHaveCount(0);

  // A new logo is a suggestion: the workspace keeps its approved identity until the new one is approved.
  await b.page.evaluate(() => localStorage.setItem('theme', 'light'));
  await b.page.goto(`/en/organization/${setB.orgId}/setup?step=2`);
  await b.page.setInputFiles('input[type=file]', { name: 'new-logo.png', mimeType: 'image/png', buffer: await logo('<rect x="40" y="60" width="400" height="120" fill="#0f766e"/>') });
  await expect(b.page.getByText('Suggested — not applied yet')).toBeVisible({ timeout: 30_000 });
  const buttonColour = async () => {
    await b.page.goto(`/en/organization/${setB.orgId}`, { waitUntil: 'networkidle' });
    return rgbHex(await b.page.locator(`[data-org-workspace="${setB.orgId}"] .btn-primary`).first().evaluate((el) => getComputedStyle(el).backgroundColor));
  };
  expect(await buttonColour()).toBe(orgB.branding.palette.light.primary);
  await b.page.goto(`/en/organization/${setB.orgId}/setup?step=2`);
  await b.page.getByRole('button', { name: 'Use this identity and continue' }).click();
  await expect(b.page).toHaveURL(/setup\?step=3/, { timeout: 20_000 });
  const renewed = (await call(b.tok, 'GET', `/organizations/${setB.orgId}`)).body;
  expect(await buttonColour()).toBe(renewed.branding.applied_palette.light.primary);
  expect(renewed.branding.applied_palette.light.primary).not.toBe(orgB.branding.palette.light.primary);

  // The same setup in Arabic, right to left.
  await a.page.evaluate(() => localStorage.setItem('theme', 'light'));
  await a.page.goto(`/ar/organization/${setA.orgId}/setup?step=2`);
  await expect(a.page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(a.page.getByRole('heading', { name: 'الهوية المستخرجة من شعارك' })).toBeVisible();
  await shot(a.page, 'telecom-identity-ar');
});
