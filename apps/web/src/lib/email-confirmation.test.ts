import assert from 'node:assert/strict';
import { test } from 'node:test';
// The native Node test runner needs the explicit TypeScript extension.
// @ts-ignore allowImportingTsExtensions is deliberately not changed for the application.
import { authError, confirmationRedirectUrl, confirmationRetryAfter, parseEmailConfirmation } from './email-confirmation.ts';
// @ts-ignore native Node test import
import { ConfirmationResendLimiter } from './email-confirmation-rate-limit.ts';

test('confirmation redirects use the configured origin, locale and employer audience', () => {
  assert.equal(confirmationRedirectUrl('http://localhost:3100', 'en'), 'http://localhost:3100/en/auth/confirmed');
  assert.equal(confirmationRedirectUrl('https://midan.example/', 'ar', true), 'https://midan.example/ar/auth/confirmed?as=organization');
  assert.equal(confirmationRedirectUrl('http://127.0.0.1:3100', 'ar'), 'http://127.0.0.1:3100/ar/auth/confirmed');
  assert.equal(confirmationRedirectUrl('http://[::1]:3100', 'en'), 'http://[::1]:3100/en/auth/confirmed');
});

test('confirmation redirects reject missing, insecure or non-origin application URLs', () => {
  for (const appUrl of [undefined, '', '/relative', '//midan.example', 'http://midan.example', 'http://localhost.evil.test',
    'https://user:password@midan.example', 'https://midan.example/path', 'https://midan.example?redirect=evil',
    'https://midan.example/#token', 'https://midan.example\\evil', ' https://midan.example']) {
    assert.throws(() => confirmationRedirectUrl(appUrl, 'en'));
  }
  assert.throws(() => confirmationRedirectUrl('https://midan.example', '../evil'));
});

test('rate-limit responses stay errors even without a provider error code', () => {
  assert.equal(authError({}, 429), 'over_request_rate_limit');
  assert.equal(authError(undefined, 429), 'over_request_rate_limit');
  assert.equal(authError({ error_code: 'unexpected_failure' }, 429), 'over_request_rate_limit');
  assert.equal(authError({ msg: 'email rate limit exceeded' }, 429), 'over_email_send_rate_limit');
  assert.equal(authError({ error_code: 'over_email_send_rate_limit' }, 429), 'over_email_send_rate_limit');
});

test('provider errors distinguish delivery restrictions and failures without exposing diagnostics', () => {
  assert.equal(authError({ error_code: 'email_address_not_authorized' }, 403), 'email_address_not_authorized');
  assert.equal(authError({ msg: 'Email address not authorized' }, 403), 'email_address_not_authorized');
  assert.equal(authError({ error_code: 'unexpected_failure', msg: 'Error sending confirmation email' }, 500), 'email_delivery_failed');
  assert.equal(authError({ msg: 'SMTP connection refused for private configuration' }, 500), 'email_delivery_failed');
  assert.equal(authError({ error_code: 'unexpected_failure' }, 500), 'generic');
  assert.equal(authError({ error_code: 'email_exists' }, 422), 'user_already_exists');
  assert.equal(authError({ error_code: 'email_not_confirmed' }, 400), 'email_not_confirmed');
  assert.equal(authError({ error_code: 'otp_expired' }, 403), 'confirmation_link_invalid');
});

test('missing confirmation data is not a confirmed session', () => {
  assert.deepEqual(parseEmailConfirmation('', '?as=organization'), { kind: 'missing' });
  assert.deepEqual(parseEmailConfirmation('', '?access_token=query-token&refresh_token=query-refresh'), { kind: 'missing' });
  assert.deepEqual(parseEmailConfirmation('#type=signup'), { kind: 'missing' });
});

test('expired links and malformed token fragments are errors', () => {
  for (const [hash, search] of [
    ['#error=access_denied&error_code=otp_expired', ''],
    ['', '?error_code=otp_expired'],
    ['#access_token=access&refresh_token=refresh', '?error=denied'],
    ['#access_token=access', ''], ['#refresh_token=refresh', ''],
    ['#access_token=&refresh_token=refresh', ''],
    ['#access_token=a&access_token=b&refresh_token=refresh', ''],
    ['#access_token=access&refresh_token=refresh&refresh_token=duplicate', ''],
    ['#access_token=has%20space&refresh_token=refresh', ''],
    [`#access_token=${'a'.repeat(8193)}&refresh_token=refresh`, ''],
    [`#access_token=access&refresh_token=${'r'.repeat(1025)}`, ''],
  ]) assert.deepEqual(parseEmailConfirmation(hash, search), { kind: 'error', error: 'invalid' });
});

test('valid token fragments are forwarded for server-side Auth verification', () => {
  assert.deepEqual(parseEmailConfirmation('#access_token=header.payload.signature&refresh_token=opaque-refresh&type=signup', '?as=organization'),
    { kind: 'session', accessToken: 'header.payload.signature', refreshToken: 'opaque-refresh' });
  assert.equal(parseEmailConfirmation(`#access_token=${'a'.repeat(8192)}&refresh_token=${'r'.repeat(1024)}`).kind, 'session');
});

test('resend consumes the email cooldown immediately and permits it again after sixty seconds', () => {
  const limiter = new ConfirmationResendLimiter();
  assert.deepEqual(limiter.consume('normalized-email-hash', 1000), { allowed: true });
  // There is no release-on-error method: a failed upstream request still consumes the slot.
  assert.deepEqual(limiter.consume('normalized-email-hash', 1000), { allowed: false, retryAfter: 60 });
  assert.deepEqual(limiter.consume('normalized-email-hash', 60_999), { allowed: false, retryAfter: 1 });
  assert.deepEqual(limiter.consume('normalized-email-hash', 61_000), { allowed: true });
});

test('resend limits distinct recipients globally to ten requests per minute in this process', () => {
  const limiter = new ConfirmationResendLimiter();
  for (let i = 0; i < 10; i++) assert.deepEqual(limiter.consume(`email-hash-${i}`, 1000), { allowed: true });
  assert.deepEqual(limiter.consume('eleventh-email-hash', 1000), { allowed: false, retryAfter: 60 });
  assert.deepEqual(limiter.consume('eleventh-email-hash', 61_000), { allowed: true });
});

test('resend map is bounded and does not evict active recipients to admit new ones', () => {
  const limiter = new ConfirmationResendLimiter(1);
  assert.deepEqual(limiter.consume('first-email-hash', 1000), { allowed: true });
  assert.deepEqual(limiter.consume('second-email-hash', 2000), { allowed: false, retryAfter: 59 });
  assert.deepEqual(limiter.consume('first-email-hash', 2000), { allowed: false, retryAfter: 59 });
  assert.deepEqual(limiter.consume('second-email-hash', 61_000), { allowed: true });
  assert.throws(() => new ConfirmationResendLimiter(1001));
});

test('provider Retry-After extends cooldowns and a new email cannot bypass capacity', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(confirmationRetryAfter('3600', now), 3600);
  assert.equal(confirmationRetryAfter('Tue, 10 Nov 2026 00:02:00 GMT', now), 120);
  assert.equal(confirmationRetryAfter('invalid', now), 60);
  assert.equal(confirmationRetryAfter(null, now), 60);
  assert.equal(confirmationRetryAfter('9999999999999', now), 86_400);
  const limiter = new ConfirmationResendLimiter(1);
  limiter.consume('email-hash', now);
  limiter.defer('email-hash', 3600, now);
  limiter.defer('another-hash', 3600, now);
  assert.deepEqual(limiter.consume('email-hash', now + 60_000), { allowed: false, retryAfter: 3540 });
  assert.deepEqual(limiter.consume('another-hash', now + 60_000), { allowed: false, retryAfter: 3540 });
});
