// LOCAL STACK ONLY. Opens MIDAN's main screens in light and dark, as a visitor, a candidate, an employer and a platform
// administrator, and measures the contrast of every visible piece of text and every form control (select, option,
// input, textarea, listbox, menu, badge) against the background it's actually drawn on. Anything under WCAG AA is
// listed with its page, theme and selector. Screenshots go to .local/theme-audit/.
//
//   node apps/web/scripts/theme-audit.mjs [--shots] [--org <orgId>]
//
// Exits 1 when anything fails, so it can gate a change.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { chromium } from '@playwright/test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const env = { ...parseEnv(readFileSync(`${ROOT}.env`, 'utf8')), ...parseEnv(readFileSync(`${ROOT}.env.test.local`, 'utf8')) };
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Local stack only');
const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = `${ROOT}.local/theme-audit`;
mkdirSync(OUT, { recursive: true });
const SHOTS = process.argv.includes('--shots');
const orgArg = process.argv.indexOf('--org');

async function tokens(who) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`] ?? who.split(':')[0], password: env[`TEST_${who}_PASSWORD`] ?? who.split(':')[1] }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${who}`);
  return res.json();
}

// Runs in the page: every element with its own text, and every control, with its colour and the colour beneath it.
function measure() {
  // Any CSS colour (rgb, oklab, color-mix results…) to [r, g, b, a], by letting the browser paint it.
  const ctx = (window.__auditCtx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }));
  const cache = (window.__auditCache ??= new Map());
  const parse = (c) => {
    if (cache.has(c)) return cache.get(c);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const value = [r, g, b, a / 255];
    cache.set(c, value);
    return value;
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (!a) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const background = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url')) return null; // a gradient: not measurable
      const bg = parse(cs.backgroundColor);
      if (bg[3] > 0) stack.push(bg);
      if (bg[3] >= 1) break;
    }
    let result = parse(getComputedStyle(document.body).backgroundColor);
    for (const layer of stack.reverse()) result = over(layer, result);
    return result;
  };
  const path = (el) => {
    const parts = [];
    for (let n = el; n && parts.length < 4 && n !== document.body; n = n.parentElement) {
      parts.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''));
    }
    return parts.join(' > ');
  };
  const failures = [];
  const seen = new Set();
  const controls = 'select, option, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]):not([type=range]), textarea, [role=listbox], [role=option], [role=menu], [role=menuitem], [role=combobox], [role=tooltip], dialog';
  const candidates = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('[aria-hidden=true], svg, script, style, noscript')) return false;
    if (el.matches(controls)) return true;
    return [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
  });
  for (const el of candidates) {
    const cs = getComputedStyle(el);
    const isOption = el.tagName === 'OPTION';
    const box = (isOption ? el.closest('select') : el).getBoundingClientRect();
    if (!isOption && (box.width === 0 || box.height === 0 || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) continue;
    if (el.closest('.sr-only')) continue;
    // Text drawn over the 3D scene or a photo carries its own shadow for legibility; the colour beneath isn't in the DOM.
    if (el.closest('.drop-shadow, [class*="drop-shadow-"], [data-over-scene]')) continue;
    const bg = background(el);
    if (!bg) continue;
    const fg = over(parse(cs.color), bg);
    const value = ratio(fg, bg);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const disabled = el.matches(':disabled') || el.closest('fieldset:disabled') || el.getAttribute('aria-disabled') === 'true';
    const need = disabled ? 0 : large ? 3 : 4.5; // WCAG exempts disabled controls; they're still checked to be visible below
    if (value < need || (disabled && value < 1.6)) {
      const key = `${path(el)}|${cs.color}|${cs.backgroundColor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ el: path(el), text: (el.value || el.textContent || '').trim().slice(0, 60), ratio: Math.round(value * 100) / 100, need, color: cs.color, background: `rgb(${bg.slice(0, 3).map(Math.round).join(' ')})` });
    }
  }
  return failures;
}

const orgFromApi = async (tok) => {
  const me = await (await fetch(`${env.API_URL}/v1/me`, { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
  return me.organization_members?.[0]?.org_id;
};

// CHROMIUM_PATH: a browser other than the one this Playwright version downloads (as for the e2e suites).
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
const audiences = [
  { who: null, pages: ['/', '/login', '/register', '/register?as=organization', '/opportunities', '/employers', '/how-it-works', '/for-organizations', '/faq'] },
  { who: 'CANDIDATE_ONE', pages: ['/dashboard', '/profile', '/onboarding', '/onboarding?step=3', '/onboarding?step=5', '/applications', '/assessments', '/interviews', '/development', '/settings', '/notifications'] },
  { who: process.env.AUDIT_EMPLOYER ?? 'ORG_A_OWNER', org: true, pages: ['', '/setup', '/setup?step=2', '/setup?step=3', '/jobs', '/candidates', '/assessments', '/interviews', '/hiring', '/reports', '/settings', '/assistant'] },
  { who: 'PLATFORM_ADMIN', pages: ['/admin', '/admin/access', '/admin/organizations', '/admin/employers', '/admin/queue', '/admin/accounts'] },
];
for (const audience of audiences) {
  const tok = audience.who ? await tokens(audience.who) : null;
  const orgId = audience.org ? (orgArg > 0 ? process.argv[orgArg + 1] : await orgFromApi(tok)) : null;
  if (audience.org && !orgId) { console.log(`skipped ${audience.who}: no workspace`); continue; }
  if (audience.org) {
    // The job and applicant screens, when the workspace has any.
    const get = async (path) => (await fetch(`${env.API_URL}/v1${path}`, { headers: { authorization: `Bearer ${tok.access_token}` } })).json().catch(() => null);
    const jobs = await get(`/organizations/${orgId}/jobs`);
    if (Array.isArray(jobs) && jobs[0]) {
      audience.pages.push(`/jobs/${jobs[0].id}`);
      const job = await get(`/organizations/${orgId}/jobs/${jobs[0].id}`);
      const application = job?.applications?.[0];
      if (application) audience.pages.push(`/applicants/${application.id}`);
    }
  }
  for (const theme of ['light', 'dark']) {
    for (const locale of ['en', 'ar']) {
      const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: theme });
      await context.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
      if (tok) {
        const cookie = { domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' };
        await context.addCookies([{ ...cookie, name: 'midan_at', value: tok.access_token }, { ...cookie, name: 'midan_rt', value: tok.refresh_token }]);
      }
      const page = await context.newPage();
      for (const p of audience.pages) {
        const path = audience.org ? `/organization/${orgId}${p}` : p;
        const url = `${WEB}/${locale}${path}`;
        const response = await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => `error ${e.message}` }));
        const status = response?.status();
        if (status !== 200) { results.push({ url, theme, locale, status, failures: [] }); continue; }
        await page.waitForTimeout(150);
        const actual = await page.evaluate(() => document.documentElement.dataset.theme);
        const failures = await page.evaluate(measure);
        // English digits everywhere, in Arabic too: any Arabic-Indic digit on screen is a failure.
        const indic = await page.evaluate(() => (document.body.innerText.match(/[^\n]{0,30}[٠-٩۰-۹][^\n]{0,30}/g) ?? []).slice(0, 5));
        results.push({ url, theme, locale, status, applied: actual, failures, indic });
        if (SHOTS && locale === 'en') await page.screenshot({ path: `${OUT}/${theme}-${audience.org ? 'employer' : (audience.who ?? 'visitor').toLowerCase()}${path.replace(/[/?=]+/g, '_') || '_home'}.png`, fullPage: true });
      }
      await context.close();
    }
  }
}
await browser.close();

const failing = results.filter((r) => r.failures.length);
const numerals = results.filter((r) => r.indic?.length);
for (const r of numerals) console.log(`Arabic-Indic digits  ${r.theme} ${r.url}: ${r.indic.join(' | ')}`);
const broken = results.filter((r) => r.status !== 200);
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
for (const r of failing) {
  console.log(`\n${r.theme.padEnd(5)} ${r.locale} ${r.url}`);
  for (const f of r.failures.slice(0, 12)) console.log(`   ${f.ratio}:1 (needs ${f.need})  "${f.text}"  ${f.el}  [${f.color} on ${f.background}]`);
  if (r.failures.length > 12) console.log(`   … ${r.failures.length - 12} more`);
}
for (const r of broken) console.log(`status ${r.status}  ${r.theme} ${r.url}`);
const wrongTheme = results.filter((r) => r.status === 200 && r.applied !== r.theme);
for (const r of wrongTheme) console.log(`theme not applied (${r.applied})  ${r.theme} ${r.url}`);
console.log(`\n${results.length} page renders, ${failing.length} with contrast failures (${failing.reduce((n, r) => n + r.failures.length, 0)} elements), ${broken.length} not 200, ${wrongTheme.length} wrong theme.`);
console.log(`${numerals.length} page renders with Arabic-Indic digits.`);
process.exit(failing.length || wrongTheme.length || numerals.length ? 1 : 0);
