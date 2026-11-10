/** Only the configured application origin can receive confirmation redirects. Never use a request Host header. */
export function confirmationRedirectUrl(appUrl: string | undefined, locale: string, organization = false): string {
  if (!appUrl || /[\\\s]/.test(appUrl) || !['ar', 'en'].includes(locale)) throw new Error('Invalid confirmation redirect configuration');
  const origin = new URL(appUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local))
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('APP_URL must be an HTTPS origin or a local HTTP origin');
  }
  const redirect = new URL(`/${locale}/auth/confirmed`, origin.origin);
  if (organization) redirect.searchParams.set('as', 'organization');
  return redirect.toString();
}

type AuthErrorResponse = { error_code?: unknown; msg?: unknown; message?: unknown; error_description?: unknown };
const KNOWN_ERRORS = new Set([
  'invalid_credentials', 'email_not_confirmed', 'weak_password', 'user_already_exists',
  'email_address_invalid', 'email_address_not_authorized', 'over_email_send_rate_limit', 'over_request_rate_limit',
]);

/** Return message keys, never provider response bodies, email addresses or SMTP diagnostics. */
export function authError(data: AuthErrorResponse | null | undefined, status?: number): string {
  const code = typeof data?.error_code === 'string' ? data.error_code : '';
  const description = [data?.msg, data?.message, data?.error_description].filter((value): value is string => typeof value === 'string').join(' ');
  const emailRateLimit = code === 'over_email_send_rate_limit' || /email.{0,30}rate limit|rate limit.{0,30}email/i.test(description);
  // Some proxy/provider errors omit error_code. HTTP 429 must never become a successful send or unrelated error.
  if (status === 429) return emailRateLimit ? 'over_email_send_rate_limit' : 'over_request_rate_limit';
  if (code === 'email_exists') return 'user_already_exists';
  if (['otp_expired', 'otp_disabled'].includes(code)) return 'confirmation_link_invalid';
  if (KNOWN_ERRORS.has(code)) return code;
  if (emailRateLimit) return 'over_email_send_rate_limit';
  if (/email address.{0,60}not authorized|only send.{0,60}(?:team|authorized)/i.test(description)) return 'email_address_not_authorized';
  if (['email_send_failed', 'smtp_error'].includes(code) || /smtp|error sending (?:confirmation|email)|failed to send.{0,30}email/i.test(description)) return 'email_delivery_failed';
  // unexpected_failure can be an SMTP, hook or database failure; it does not establish that registration is closed.
  return 'generic';
}

/** Honor longer provider cooldowns without trusting an unbounded header value. */
export function confirmationRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 60;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.min(86_400, Math.max(60, seconds)) : 60;
}

export type EmailConfirmation =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; error: 'invalid' }
  | { kind: 'missing' };

/** Email tokens belong in the fragment; query-string tokens are deliberately not accepted. */
export function parseEmailConfirmation(hash: string, search = ''): EmailConfirmation {
  if (hash.length > 10240 || search.length > 4096) return { kind: 'error', error: 'invalid' };
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  if (['error', 'error_code', 'error_description'].some((key) => fragment.has(key) || query.has(key))) return { kind: 'error', error: 'invalid' };
  if (!fragment.has('access_token') && !fragment.has('refresh_token')) return { kind: 'missing' };
  const accessToken = fragment.get('access_token') ?? '';
  const refreshToken = fragment.get('refresh_token') ?? '';
  if (fragment.getAll('access_token').length !== 1 || fragment.getAll('refresh_token').length !== 1
      || !accessToken || !refreshToken || accessToken.length > 8192 || refreshToken.length > 1024
      || /\s|\p{Cc}/u.test(accessToken + refreshToken)) return { kind: 'error', error: 'invalid' };
  return { kind: 'session', accessToken, refreshToken };
}
