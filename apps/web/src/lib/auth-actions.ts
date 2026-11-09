'use server';

import { createHash, randomBytes } from 'node:crypto';
import { getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect as redirectExternal } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { homeFor } from './home';
import { safeNext } from './next-path';
import { clearSessionCookies, decodeToken, getAccessToken, setSessionCookies } from './session';

export type FormState = { error?: string; ok?: boolean; id?: string };

const KNOWN = new Set([
  'invalid_credentials', 'email_not_confirmed', 'weak_password', 'user_already_exists', 'email_exists',
  'email_address_invalid', 'email_address_not_authorized', 'over_email_send_rate_limit', 'over_request_rate_limit',
]);

async function gotrue(path: string, body: unknown, token?: string, method = 'POST') {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`, {
    method,
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
  redirect({
    href: safeNext(form.get('next')) ?? (await homeFor(decodeToken(result.data.access_token)?.accountType, result.data.access_token)),
    locale: await getLocale(),
  });
  return {};
}

/** The answer is the same whether or not the address has an account, so this can't be used to find accounts. */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email_address_invalid' };
  try {
    const back = encodeURIComponent(`${process.env.APP_URL}/${await getLocale()}/reset-password`);
    const { ok, data } = await gotrue(`recover?redirect_to=${back}`, { email });
    if (!ok && data.error_code === 'over_email_send_rate_limit') return { error: 'over_email_send_rate_limit' };
    if (!ok && data.error_code === 'over_request_rate_limit') return { error: 'over_request_rate_limit' };
  } catch {
    return { error: 'unavailable' };
  }
  return { ok: true };
}

/** The recovery token comes from the emailed link, and proves who is changing the password. */
export async function resetPassword(recoveryToken: string, password: string): Promise<FormState> {
  if (password.length < 8) return { error: 'weak_password' };
  try {
    const { ok, data } = await gotrue('user', { password }, recoveryToken, 'PUT');
    if (!ok) {
      if (data.error_code === 'same_password') return { error: 'same_password' };
      if (data.error_code === 'weak_password') return { error: 'weak_password' };
      return { error: 'reset_link_invalid' };
    }
    await gotrue('logout?scope=global', {}, recoveryToken).catch(() => undefined);
  } catch {
    return { error: 'unavailable' };
  }
  await clearSessionCookies();
  return { ok: true };
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '');
  const token = await getAccessToken();
  if (!token) return { error: 'session' };
  if (password.length < 8) return { error: 'weak_password' };
  try {
    const { ok, data } = await gotrue('user', { password }, token, 'PUT');
    if (!ok) return { error: data.error_code === 'same_password' ? 'same_password' : authError(data) };
  } catch {
    return { error: 'unavailable' };
  }
  return { ok: true };
}

/** Whether Google is switched on in Supabase Auth. Without this the button would only lead to an error. */
export async function googleSignInEnabled() {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY as string },
      next: { revalidate: 300 },
    });
    return response.ok && Boolean(((await response.json()) as { external?: { google?: boolean } }).external?.google);
  } catch {
    return false;
  }
}

export async function startGoogleSignIn(form: FormData) {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const store = await cookies();
  const cookie = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 } as const;
  store.set('midan_pkce', verifier, cookie);
  const next = safeNext(form.get('next'));
  if (next) store.set('midan_next', next, cookie);
  const back = `${process.env.APP_URL}/${await getLocale()}/auth/callback`;
  const url = new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', back);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  redirectExternal(url.toString());
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
  let result;
  try {
    const locale = await getLocale();
    // The confirmation page then offers the sign-in for the audience the person chose.
    const back = encodeURIComponent(`${process.env.APP_URL}/${locale}/auth/confirmed${accountType === 'organization' ? '?as=organization' : ''}`);
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
  const locale = await getLocale();
  if (result.data.access_token) {
    await setSessionCookies(result.data.access_token, result.data.refresh_token);
    redirect({ href: await homeFor(accountType, result.data.access_token), locale });
  }
  redirect({ href: '/check-email', locale });
  return {};
}

/**
 * After the verification link, Supabase Auth has already signed the person in and put that session in the link's
 * fragment. This carries it into the app's cookies, so nobody has to sign in a second time. Auth itself confirms the
 * session first (/auth/v1/user), and only a session made by an email link (amr "otp") for a confirmed address is
 * accepted: a password session pasted into a link isn't. Anything else falls back to the sign-in button.
 */
export async function continueFromEmailLink(accessToken: string, refreshToken: string): Promise<{ href?: string; error?: string }> {
  if (!accessToken || !refreshToken || accessToken.length > 8192 || refreshToken.length > 1024) return { error: 'invalid' };
  let user: { email_confirmed_at?: string | null };
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      cache: 'no-store',
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY as string, authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { error: 'invalid' };
    user = await response.json();
  } catch {
    return { error: 'unavailable' };
  }
  let amr: { method?: string }[] = [];
  try {
    amr = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).amr ?? [];
  } catch {
    return { error: 'invalid' };
  }
  if (!user.email_confirmed_at || !amr.some((m) => m.method === 'otp')) return { error: 'invalid' };
  await setSessionCookies(accessToken, refreshToken);
  return { href: await homeFor(decodeToken(accessToken)?.accountType, accessToken) };
}

export async function signOut() {
  const token = await getAccessToken();
  if (token) await gotrue('logout?scope=local', {}, token).catch(() => undefined);
  await clearSessionCookies();
  redirect({ href: '/', locale: await getLocale() });
}
