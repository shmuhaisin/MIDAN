#!/usr/bin/env node
// Gets a Google Calendar refresh token for the local demo and writes it into .env, without printing it.
//   node scripts/google-calendar-token.mjs
// It needs GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET in .env, from an OAuth client of type
// "Desktop app" (Google allows any http://127.0.0.1 port for those). It prints a Google sign-in link; whoever owns the
// test calendar opens it, signs in to Google there, and allows access. Google then sends the browser back to this
// script on 127.0.0.1, which exchanges the code and saves the refresh token to .env. The only permission asked for is
// managing calendar events (calendar.events). Restart the API afterwards so it loads the token.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const file = resolve(import.meta.dirname, '..', '.env');
const text = readFileSync(file, 'utf8');
const env = parseEnv(text);
if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
  console.error('Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET to .env first.');
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 53682);
const redirect = `http://127.0.0.1:${PORT}/callback`;
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(16).toString('hex');
const link = new URL('https://accounts.google.com/o/oauth2/v2/auth');
link.search = new URLSearchParams({
  client_id: env.GOOGLE_CALENDAR_CLIENT_ID, redirect_uri: redirect, response_type: 'code',
  scope: 'https://www.googleapis.com/auth/calendar.events', access_type: 'offline', prompt: 'consent',
  state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
}).toString();

const page = (res, status, ar, en) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#F7F4EE;color:#1F2A26;padding:2rem">
<p dir="rtl" lang="ar">${ar}</p><p lang="en">${en}</p></body>`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirect);
  // A short address to type or paste, which sends the browser to Google with this session's exact parameters.
  if (url.pathname === '/start') { res.writeHead(302, { location: link.toString() }); return res.end(); }
  if (url.pathname !== '/callback') return page(res, 404, 'غير موجود.', 'Not found.');
  if (url.searchParams.get('state') !== state) return page(res, 400, 'الطلب لا يطابق هذه الجلسة.', "This request doesn't match this session.");
  const code = url.searchParams.get('code');
  if (!code) {
    page(res, 400, 'لم يُمنح الإذن. يمكنكم إغلاق الصفحة وإعادة المحاولة.', `Access wasn't granted (${url.searchParams.get('error') ?? 'no code'}).`);
    console.error(`Google returned no code: ${url.searchParams.get('error') ?? 'unknown'}`);
    return server.close();
  }
  const exchange = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const body = await exchange.json();
  if (!exchange.ok || !body.refresh_token) {
    page(res, 500, 'تعذّر الحصول على الرمز. راجعوا الطرفية.', "Couldn't get the token. See the terminal.");
    console.error(`Token exchange failed: ${exchange.status} ${body.error ?? ''} ${body.error_description ?? (body.refresh_token ? '' : '(no refresh token returned)')}`);
    return server.close();
  }
  const current = readFileSync(file, 'utf8');
  const line = `GOOGLE_CALENDAR_REFRESH_TOKEN=${body.refresh_token}`;
  writeFileSync(file, /^GOOGLE_CALENDAR_REFRESH_TOKEN=.*$/m.test(current) ? current.replace(/^GOOGLE_CALENDAR_REFRESH_TOKEN=.*$/m, line) : `${current.trimEnd()}\n${line}\n`);
  page(res, 200, 'تم حفظ الرمز في ملف ‎.env‎ المحلي. يمكنكم إغلاق هذه الصفحة.', 'The token is saved in the local .env. You can close this page.');
  console.log(`Saved a refresh token (${body.refresh_token.length} characters) to ${file}. Scope: ${body.scope}. Restart the API to load it.`);
  server.close();
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this link, sign in to Google with the test calendar\'s account, and allow access:\n');
  console.log(link.toString());
  console.log(`\nOr open http://127.0.0.1:${PORT}/start in a browser on this machine, which goes to the same link.`);
  console.log(`Waiting on ${redirect} …`);
});
