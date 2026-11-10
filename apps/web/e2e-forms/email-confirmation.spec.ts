// These tests send mail requests only to stub-auth.mjs. They do not prove external inbox delivery.
import { expect, test } from '@playwright/test';

const ON = 'http://localhost:3200';
type Call = { path: string; query?: string; email?: string; data?: Record<string, string> };
const calls = async (): Promise<Call[]> => (await (await fetch('http://localhost:54399/__calls')).json()) as Call[];
const resendsFor = async (email: string) => (await calls()).filter((c) => c.path === '/auth/v1/resend' && c.email === email);

test('missing, expired and forged confirmation sessions never report verified email', async ({ page }) => {
  for (const suffix of ['', '#error=access_denied&error_code=otp_expired', '?error=access_denied&error_code=otp_expired', '#access_token=forged-token&refresh_token=forged-refresh']) {
    await page.goto(`${ON}/en/auth/confirmed${suffix}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/couldn.t confirm your email/i);
    await expect(page.getByRole('heading', { name: /email confirmed/i })).toHaveCount(0);
    await expect(page).not.toHaveURL(/#.*(?:access_token|refresh_token)/);
    expect((await page.context().cookies()).some((c) => c.name === 'midan_at')).toBe(false);
  }
});

test('failed confirmation preserves employer audience in its resend route', async ({ page }) => {
  await page.goto(`${ON}/en/auth/confirmed?as=organization#error_code=otp_expired`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/couldn.t confirm your email/i);
  await page.getByRole('link', { name: /resend|confirmation email/i }).click();
  await expect(page).toHaveURL(/\/en\/check-email\?as=organization$/);
  await expect(page.locator('input[name="account_type"]')).toHaveValue('organization');
});

test('confirmation resend is generic and server cooldown survives a fresh browser context', async ({ page, browser }) => {
  const email = `resend-cooldown-${Date.now()}@example.test`;
  await page.goto(`${ON}/en/check-email?as=organization`);
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole('button', { name: 'Resend confirmation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /if|eligible/i })).toBeVisible();
  expect(await resendsFor(email)).toHaveLength(1);
  expect(decodeURIComponent((await resendsFor(email))[0].query ?? '')).toContain('/en/auth/confirmed?as=organization');
  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    await secondPage.goto(`${ON}/en/check-email?as=organization`);
    await secondPage.locator('input[name="email"]').fill(email.toUpperCase());
    await secondPage.getByRole('button', { name: 'Resend confirmation', exact: true }).click();
    await expect(secondPage.locator('p[role="alert"]')).toContainText(/wait|minute|too many|try again/i);
    expect(await resendsFor(email)).toHaveLength(1);
  } finally {
    await secondContext.close();
  }
});

test('rate-limited and restricted-recipient signup stays on the form with accurate errors', async ({ page }) => {
  for (const email of ['email-rate-limit@example.test', 'recipient-restricted@example.test', 'smtp-failed@example.test']) {
    await page.goto(`${ON}/en/register`);
    await page.locator('input[name="display_name"]').fill('Fictional Candidate');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('form-test-password-1');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/en\/register$/);
    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toHaveCount(0);
    await expect(page.locator('p[role="alert"]')).not.toContainText(/use the email of a member/i);
    if (email.startsWith('smtp')) await expect(page.locator('p[role="alert"]')).not.toContainText(/registration.*closed/i);
  }
});

test('resend surfaces provider quota errors instead of pretending an email was delivered', async ({ page }) => {
  await page.goto(`${ON}/en/check-email`);
  await page.locator('input[name="email"]').fill('email-rate-limit@example.test');
  await page.getByRole('button', { name: 'Resend confirmation', exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/email.*limit|sending.*limit|rate limit/i);
  await expect(page.getByRole('status')).not.toContainText(/sent|if.*account/i);
});

test('Arabic confirmation failures and resend controls remain available', async ({ page }) => {
  await page.goto(`${ON}/ar/auth/confirmed#error_code=otp_expired`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('تم تأكيد بريدك');
  await page.goto(`${ON}/ar/check-email?as=organization`);
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
