// The real sign-in and sign-up forms, in both languages. See stub-auth.mjs for why passwords stop at localhost.
import { expect, test, type Page } from '@playwright/test';

const ON = 'http://localhost:3200';
const OFF = 'http://localhost:3201';
const PASSWORD = 'form-test-password-1';
const calls = async () => (await (await fetch('http://localhost:54399/__calls')).json()) as { path: string; query?: string; email?: string; data?: Record<string, string> }[];
const context_cookies = (page: Page) => page.context().cookies();

test.beforeAll(async () => {
  // These tests prove nothing about real data unless the API is up.
  expect((await fetch('http://localhost:4000/v1/health')).status).toBe(200);
});

test('candidate sign-up accepts a Gmail address and asks to confirm it', async ({ page }) => {
  await page.goto(`${ON}/ar/register`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('جاهز تدخل الميدان؟');
  await expect(page.getByText('بيئة اختبار للتطوير')).toBeVisible();
  await expect(page.locator('img[src*="01_Humaidan_Original"]')).toBeVisible();
  await page.getByLabel('الاسم').fill('مرشح خيالي');
  await page.getByLabel('البريد الإلكتروني').fill('someone.fictional@gmail.com');
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page).toHaveURL(/\/ar\/check-email$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تأكد من بريدك');

  const signup = (await calls()).findLast((c) => c.path === '/auth/v1/signup');
  expect(signup?.email).toBe('someone.fictional@gmail.com');
  expect(signup?.data?.account_type).toBe('candidate');
  expect(signup?.data?.midan_test_access).toBeTruthy();
  expect(decodeURIComponent(signup?.query ?? '')).toContain('/ar/auth/confirmed');
  expect((await context_cookies(page)).filter((c) => c.name.startsWith('midan_'))).toEqual([]);
});

test('organization sign-up is formal, has no mascot, and sends the organization names', async ({ page }) => {
  await page.goto(`${ON}/en/register?as=organization`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Register your organization');
  await expect(page.locator('img[src*="Humaidan"]')).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill('Fictional Org Admin');
  await page.getByLabel('Organization name in Arabic').fill('منشأة خيالية');
  await page.getByLabel('Organization name in English').fill('Fictional Org');
  await page.getByLabel('Email').fill('admin.fictional@gmail.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/en\/check-email\?as=organization$/);
  const signup = (await calls()).findLast((c) => c.path === '/auth/v1/signup');
  expect(signup?.data).toMatchObject({ account_type: 'organization', org_name_ar: 'منشأة خيالية', org_name_en: 'Fictional Org' });
});

test('the access code never reaches the browser', async ({ page }) => {
  const seen: string[] = [];
  const code = process.env.DEV_TEST_ACCESS_CODE as string;
  expect(code).toBeTruthy();
  page.on('response', async (r) => {
    if (/\.(js|css)|register/.test(r.url())) seen.push(await r.text().catch(() => ''));
  });
  await page.goto(`${ON}/en/register`);
  await page.waitForLoadState('networkidle');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.some((body) => body.includes(code))).toBe(false);
});

test('signing in before confirming the email is refused with a clear message', async ({ page }) => {
  await page.goto(`${ON}/en/login`);
  await page.getByLabel('Email').fill('form.unverified@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Confirm your email first' })).toBeVisible();
});

test('sign-in: mistakes are explained, and each role lands in its own place', async ({ page, context }) => {
  await page.goto(`${ON}/en/login`);
  await page.getByLabel('Email').fill('form.candidate@example.com');
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('form.candidate@example.com'); // A mistake doesn't wipe the form.

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'My applications' })).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === 'midan_at');
  expect(cookie?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('midan_at');
  await context.clearCookies();

  await page.goto(`${ON}/en/login?as=organization`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organization sign-in');
  await page.getByLabel('Email').fill('form.org@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page).toHaveURL(/\/en\/organization\/(new|[0-9a-f-]{36})$/);
});

test('with the development flag off, there is no sign-up form at all', async ({ page }) => {
  for (const path of ['/en/register', '/en/register?as=organization']) {
    await page.goto(`${OFF}${path}`);
    await expect(page.getByText("Registration isn't available yet")).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await expect(page.getByText('Development testing environment')).toHaveCount(0);
  }
  await page.goto(`${OFF}/en/login`);
  await expect(page.getByLabel('Password')).toBeVisible();
});
