'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { clearSessionCookies, getAccessToken, setSessionCookies } from './session';

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
  redirect({ href: '/dashboard', locale: await getLocale() });
  return {};
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email');
  const password = String(form.get('password') ?? '');
  const displayName = text(form, 'display_name');
  const accountType = form.get('account_type') === 'organization' ? 'organization' : 'candidate';
  if (!email || !password || !displayName) return { error: 'required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email_address_invalid' };
  if (password.length < 8) return { error: 'weak_password' };
  let result;
  try {
    result = await gotrue('signup', { email, password, data: { display_name: displayName, account_type: accountType } });
  } catch {
    return { error: 'unavailable' };
  }
  if (!result.ok) return { error: authError(result.data) };
  const locale = await getLocale();
  if (result.data.access_token) {
    await setSessionCookies(result.data.access_token, result.data.refresh_token);
    redirect({ href: '/dashboard', locale });
  }
  redirect({ href: '/check-email', locale });
  return {};
}

export async function signOut() {
  const token = await getAccessToken();
  if (token) await gotrue('logout?scope=local', {}, token).catch(() => undefined);
  await clearSessionCookies();
  redirect({ href: '/', locale: await getLocale() });
}
