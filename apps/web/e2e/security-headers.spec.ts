// Opens the site's screens under the real Content-Security-Policy and fails on anything the policy blocks. Run it against
// a production build (npm run build && npm run start): development adds 'unsafe-eval'. Leftovers are removed by
// supabase/test-cleanup.sql. Daily and Google need real credentials, so a screen using them isn't covered here.
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

async function session(who: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { access_token: string; refresh_token: string };
}

async function pageFor(browser: Browser, who?: string) {
  const context = await browser.newContext();
  if (who) {
    const { access_token, refresh_token } = await session(who);
    const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' as const };
    await context.addCookies([
      { ...cookie, name: 'midan_at', value: access_token },
      { ...cookie, name: 'midan_rt', value: refresh_token },
    ]);
  }
  await context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return context.newPage();
}

async function visit(page: Page, paths: string[]) {
  const blocked: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) blocked.push(m.text().slice(0, 200));
  });
  for (const path of paths) {
    const response = await page.goto(path, { waitUntil: 'load' });
    expect(response?.status(), path).toBeLessThan(400);
    // A redirect would mean this role never saw the screen, and the check proved nothing about it.
    expect(new URL(page.url()).pathname, path).toBe(path);
    const policy = response?.headers()['content-security-policy'] ?? '';
    expect(policy, path).toContain("frame-ancestors 'none'");
    expect(policy, path).toMatch(/script-src [^;]*'nonce-/);
    expect(policy, path).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(response?.headers()['x-content-type-options'], path).toBe('nosniff');
    await page.waitForLoadState('networkidle');
    const violations = await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
    expect(violations, path).toEqual([]);
  }
  expect(blocked).toEqual([]);
}

test('public pages run under the policy, in both languages', async ({ browser }) => {
  const paths = ['', '/about', '/how-it-works', '/for-candidates', '/for-organizations', '/opportunities', '/employers', '/faq', '/login', '/register', '/get-started', '/forgot-password'];
  await visit(await pageFor(browser), ['ar', 'en'].flatMap((locale) => paths.map((p) => `/${locale}${p}`)));
});

test('candidate screens run under the policy', async ({ browser }) => {
  await visit(await pageFor(browser, 'CANDIDATE_ONE'), ['/en/dashboard', '/en/profile', '/en/development', '/en/notifications', '/en/settings', '/en/onboarding', '/en/opportunities', '/ar/dashboard']);
});

test('administration screens run under the policy', async ({ browser }) => {
  await visit(await pageFor(browser, 'PLATFORM_ADMIN'), ['', '/accounts', '/audit', '/employers', '/imports', '/learning', '/listings', '/queue', '/reference', '/review'].map((p) => `/en/admin${p}`));
});

test('organization screens run under the policy', async ({ browser }) => {
  const { access_token } = await session('ORG_A_OWNER');
  const created = await fetch(`${env.API_URL}/v1/organizations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: `midan-test-csp-${RUN}`, name_ar: 'سياسة', name_en: `Midan Test CSP ${RUN}` }),
  });
  expect(created.ok).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await visit(await pageFor(browser, 'ORG_A_OWNER'), [`/en/organization/${id}`, `/en/organization/${id}/settings`, '/en/organization/new']);
});

test('this check does notice what the policy blocks', async ({ browser }) => {
  const page = await pageFor(browser);
  await page.goto('/en/about');
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.src = 'https://blocked.example.com/x.png';
    document.body.append(image);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations.length)).toBeGreaterThan(0);
});

test('a page on another origin cannot frame the site', async ({ browser }) => {
  // about:blank has no policy of its own, so only the framed page's frame-ancestors can stop this.
  const page = await (await browser.newContext()).newPage();
  const refused: string[] = [];
  page.on('console', (m) => {
    if (/frame-ancestors/.test(m.text())) refused.push(m.text());
  });
  await page.setContent('<iframe id="site" src="http://localhost:3100/en/faq"></iframe>');
  await expect.poll(() => refused.length).toBeGreaterThan(0);
  await expect(page.frameLocator('#site').getByRole('heading', { level: 1 })).toHaveCount(0);
});
