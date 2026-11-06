'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { homeFor } from './home';
import { clearSessionCookies, decodeToken, getAccessToken, setSessionCookies } from './session';

export type FormState = { error?: string; ok?: boolean };

const KNOWN = new Set([
  'invalid_credentials', 'email_not_confirmed', 'weak_password', 'user_already_exists', 'email_exists',
  'email_address_invalid', 'email_address_not_authorized', 'over_email_send_rate_limit', 'over_request_rate_limit',
]);

async function gotrue(path: string, body: unknown, token?: string) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY as string,
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function authError(data: { error_code?: string }) {
  if (data.error_code === 'email_exists') return 'user_already_exists';
  // The database refuses addresses outside the demo allowlist, and Auth reports that as a failure.
  if (data.error_code === 'unexpected_failure') return 'registration_closed';
  return data.error_code && KNOWN.has(data.error_code) ? data.error_code : 'generic';
}

function text(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}

/** Where a verification email may return. Comes only from APP_URL, so no host is fixed in code. */
function confirmationRedirect(locale: string) {
  const origin = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (!origin || !/^https?:\/\//.test(origin)) return null;
  return `${origin}/${locale}/auth/confirmed`;
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email');
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'required' };
  let result;
  try {
    result = await gotrue('token?grant_type=password', { email, password });
  } catch {
    return { error: 'unavailable' };
  }
  if (!result.ok) return { error: authError(result.data) };
  await setSessionCookies(result.data.access_token, result.data.refresh_token);
  redirect({ href: await homeFor(decodeToken(result.data.access_token)?.accountType, result.data.access_token), locale: await getLocale() });
  return {};
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  // Off anywhere public. The database separately refuses every address outside the synthetic domain.
  if (process.env.DEV_TEST_SIGNUP !== 'true') return { error: 'registration_closed' };
  const email = text(form, 'email');
  const password = String(form.get('password') ?? '');
  const displayName = text(form, 'display_name');
  const accountType = form.get('account_type') === 'organization' ? 'organization' : 'candidate';
  const orgNameAr = text(form, 'org_name_ar');
  const orgNameEn = text(form, 'org_name_en');
  if (!email || !password || !displayName) return { error: 'required' };
  if (accountType === 'organization' && (!orgNameAr || !orgNameEn)) return { error: 'required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email_address_invalid' };
  if (password.length < 8) return { error: 'weak_password' };
  const locale = await getLocale();
  const confirmation = confirmationRedirect(locale);
  if (!confirmation) return { error: 'unavailable' };
  let result;
  try {
    const back = encodeURIComponent(confirmation);
    result = await gotrue(`signup?redirect_to=${back}`, {
      email,
      password,
      data: {
        display_name: displayName,
        account_type: accountType,
        ...(accountType === 'organization' && { org_name_ar: orgNameAr, org_name_en: orgNameEn }),
        midan_test_access: process.env.DEV_TEST_ACCESS_CODE,
      },
    });
  } catch {
    return { error: 'unavailable' };
  }
  if (!result.ok) return { error: authError(result.data) };
  if (result.data.access_token) {
    await setSessionCookies(result.data.access_token, result.data.refresh_token);
    redirect({ href: await homeFor(accountType, result.data.access_token), locale });
  }
  redirect({ href: accountType === 'organization' ? '/check-email?as=organization' : '/check-email', locale });
  return {};
}

export async function signOut() {
  const token = await getAccessToken();
  if (token) await gotrue('logout?scope=local', {}, token).catch(() => undefined);
  await clearSessionCookies();
  redirect({ href: '/', locale: await getLocale() });
}
