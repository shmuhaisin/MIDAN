#!/usr/bin/env node
// Verifies Daily.co and Google Calendar through the running local stack, with fictional accounts only:
//   Daily: a private room for one interview, a short-lived token for its candidate and its interviewer, each scoped to that
//          room, and refusals for anyone else. The test room is deleted at the end.
//   Google Calendar (when configured): the interview's event is created, moved when the interview is rescheduled, and
//          removed when it is cancelled, with sendUpdates=none so Google emails nobody.
// Usage, from the repository root, with the demo running and seeded:  node scripts/verify-integrations.mjs
// Local stack only. It prints no secrets, and writes its report to .local/verify/ (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...parseEnv(readFileSync(resolve(root, '.env.test.local'), 'utf8')) };
for (const k of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'API_URL']) {
  if (!/^(http|postgres(ql)?):\/\/([^@/]*@)?(localhost|127\.0\.0\.1)(:\d+)?/.test(env[k] ?? '')) throw new Error(`${k} must point at the local stack`);
}
const calendarConfigured = Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && env.GOOGLE_CALENDAR_REFRESH_TOKEN);
if (calendarConfigured && env.GOOGLE_CALENDAR_SEND_UPDATES !== 'none') {
  throw new Error('Set GOOGLE_CALENDAR_SEND_UPDATES=none in .env (and restart the API) before this check, so Google emails nobody.');
}
// The test application is removed from the local demo database (scripts/local-db.sh, its local superuser), so the demo stays as seeded and the check can run again.
const psql = `${process.env.PGBIN ?? '/opt/homebrew/opt/postgresql@16/bin'}/psql`;
const cleanup = () => execFileSync(psql, ['-q', '-v', 'ON_ERROR_STOP=1', 'postgresql://postgres:postgres@127.0.0.1:54322/midan', '-f', resolve(root, 'scripts/verify-cleanup.sql')]);
cleanup();
const report = { at: new Date().toISOString(), daily: {}, calendar: { configured: calendarConfigured } };
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

const tokens = {};
async function token(who) {
  if (tokens[who]) return tokens[who];
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env[`TEST_${who}_EMAIL`], password: env[`TEST_${who}_PASSWORD`] }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${who}`);
  return (tokens[who] = (await res.json()).access_token);
}
async function call(who, method, path, body, ok = true) {
  const res = await fetch(`${env.API_URL}/v1${path}`, { method, headers: { authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (ok && !res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, data };
}
const daily = (path, init = {}) => fetch(`https://api.daily.co/v1${path}`, { ...init, headers: { authorization: `Bearer ${env.DAILY_API_KEY}`, 'content-type': 'application/json' } });
async function google(path, method = 'GET') {
  const t = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, refresh_token: env.GOOGLE_CALENDAR_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!t.ok) throw new Error(`Google token refresh failed: ${t.status} ${(await t.json()).error ?? ''}`);
  const access = (await t.json()).access_token;
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID || 'primary')}/events/${path}`, { method, headers: { authorization: `Bearer ${access}` } });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

// A fictional application to the demo job, by the second test candidate (the demo's main candidate is left alone).
const me = (await call('ORG_A_OWNER', 'GET', '/me')).data;
const demo = me.organization_members.find((m) => m.organizations.name_en.startsWith('Oasis Digital'));
if (!demo) throw new Error('Seed the demo first: node scripts/demo-seed.mjs');
const org = demo.org_id;
const job = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/jobs`)).data.find((j) => j.slug === 'data-analyst');
if (!(await call('CANDIDATE_ONE', 'GET', '/me')).data.candidate_profiles) await call('CANDIDATE_ONE', 'PUT', '/me/candidate-profile', { full_name: 'Test Candidate One' });
const applied = await call('CANDIDATE_ONE', 'POST', `/jobs/${job.id}/applications`, {}, false);
const application = applied.status < 300 ? applied.data.id
  : (await call('CANDIDATE_ONE', 'GET', '/me/applications')).data.find((a) => a.job_id === job.id && a.status !== 'withdrawn')?.id;
if (!application) throw new Error(`Could not apply: ${applied.status} ${JSON.stringify(applied.data)}`);
const move = (status) => call('ORG_A_OWNER', 'PATCH', `/applications/${application}/status`, { status }, false);
const shortlisted = await move('shortlisted');
report.shortlist = shortlisted.status;

// The interview, with the recruiter as a second interviewer, starting in five minutes so the join window is open.
const team = (await call('ORG_A_OWNER', 'GET', `/organizations/${org}/team`)).data.members;
const recruiter = team.find((m) => m.email === env.TEST_ORG_A_RECRUITER_EMAIL);
const scheduled = await call('ORG_A_OWNER', 'POST', `/organizations/${org}/applications/${application}/interviews`,
  { scheduled_at: inMinutes(5), duration_minutes: 30, instructions_ar: 'مقابلة خيالية للتحقق.', interviewer_ids: recruiter ? [recruiter.user_id] : [] }, false);
if (scheduled.status >= 300) throw new Error(`Scheduling refused: ${scheduled.status} ${JSON.stringify(scheduled.data)}`);
const interview = scheduled.data.id;
report.calendar.after_create = scheduled.data.calendar_status;
const view = (await call('CANDIDATE_ONE', 'GET', `/interviews/${interview}`)).data;
report.daily.video_available = view.video_available;

// Daily: nobody joins before the candidate accepts; then the candidate and the interviewers each get a room token.
report.daily.candidate_before_accepting = (await call('CANDIDATE_ONE', 'POST', `/interviews/${interview}/join`, undefined, false)).status;
await call('CANDIDATE_ONE', 'POST', `/interviews/${interview}/respond`, { action: 'accept' });
const asCandidate = await call('CANDIDATE_ONE', 'POST', `/interviews/${interview}/join`);
const asOwner = await call('ORG_A_OWNER', 'POST', `/interviews/${interview}/join`);
const room = `midan-${interview}`;
const roomInfo = await (await daily(`/rooms/${room}`)).json();
const check = async (t) => { const r = await daily(`/meeting-tokens/${t}`); const p = r.ok ? await r.json() : {}; return { valid: r.ok, room: p.room_name, owner: Boolean(p.is_owner), expires_in_min: p.exp ? Math.round((p.exp * 1000 - Date.now()) / 60000) : null }; };
report.daily.room = { created: roomInfo.name === room, privacy: roomInfo.privacy, url_host: new URL(asCandidate.data.room_url).host, expires_with_window: Boolean(roomInfo.config?.exp) };
report.daily.candidate_token = await check(asCandidate.data.token);
report.daily.owner_token = await check(asOwner.data.token);
report.daily.recruiter_participant = recruiter ? (await call('ORG_A_RECRUITER', 'POST', `/interviews/${interview}/join`, undefined, false)).status : 'no recruiter in the demo team';
report.daily.other_candidate = (await call('CANDIDATE_TWO', 'POST', `/interviews/${interview}/join`, undefined, false)).status;
report.daily.other_organization = (await call('ORG_B_OWNER', 'POST', `/interviews/${interview}/join`, undefined, false)).status;
report.daily.signed_out = (await fetch(`${env.API_URL}/v1/interviews/${interview}/join`, { method: 'POST' })).status;
if (recruiter) {
  await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/interviews/${interview}`, { interviewer_ids: [] });
  report.daily.recruiter_after_removal = (await call('ORG_A_RECRUITER', 'POST', `/interviews/${interview}/join`, undefined, false)).status;
}

// Google Calendar: the event exists, moves with a reschedule, and goes with a cancellation.
const eventId = `midan${interview.replace(/-/g, '')}`;
if (calendarConfigured) {
  const created = await google(eventId);
  report.calendar.created = { found: created.status === 200, start: created.data?.start?.dateTime, attendees: created.data?.attendees?.length ?? 0 };
}
const later = inMinutes(24 * 60);
const moved = await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/interviews/${interview}`, { scheduled_at: later });
report.calendar.after_reschedule = moved.data.calendar_status;
if (calendarConfigured) {
  const after = await google(eventId);
  // Google keeps whole seconds, so the times are compared to the second.
  const second = (t) => Math.floor(new Date(t).getTime() / 1000);
  report.calendar.rescheduled = { found: after.status === 200, start: after.data?.start?.dateTime, asked_for: later, moved: second(after.data?.start?.dateTime) === second(later) };
}
const cancelled = await call('ORG_A_OWNER', 'PATCH', `/organizations/${org}/interviews/${interview}`, { status: 'cancelled' });
report.calendar.after_cancel = cancelled.data.calendar_status;
if (calendarConfigured) {
  const gone = await google(eventId);
  report.calendar.cancelled = { status: gone.status, event_status: gone.data?.status };
}

// Tidy up: the test room is deleted from Daily, and the application withdrawn.
report.daily.room_deleted = (await daily(`/rooms/${room}`, { method: 'DELETE' })).ok;
cleanup();
console.log(JSON.stringify(report, null, 1));
mkdirSync(resolve(root, '.local/verify'), { recursive: true });
writeFileSync(resolve(root, `.local/verify/integrations-${Date.now().toString(36)}.json`), JSON.stringify(report, null, 2));
