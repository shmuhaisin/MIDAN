import 'server-only';
import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'midan_at';
export const REFRESH_COOKIE = 'midan_rt';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

export type Session = { id: string; email: string; displayName?: string; accountType?: string };

/** Reads the token for display purposes only. The API verifies it on every request. */
export function decodeToken(token: string): (Session & { exp: number }) | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return {
      id: claims.sub,
      email: claims.email,
      exp: claims.exp,
      displayName: claims.user_metadata?.display_name,
      accountType: claims.user_metadata?.account_type,
    };
  } catch {
    return null;
  }
}

export async function getAccessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function getSession(): Promise<Session | null> {
  const token = await getAccessToken();
  return token ? decodeToken(token) : null;
}

export async function setSessionCookies(access: string, refresh: string) {
  const store = await cookies();
  store.set(ACCESS_COOKIE, access, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 30 });
  store.set(REFRESH_COOKIE, refresh, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 30 });
  // Signed in: the address waiting for confirmation isn't needed any more.
  store.delete(PENDING_EMAIL_COOKIE);
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/**
 * The address a person just registered with, so the confirmation page can show it and resend to it without asking for
 * it again. Kept in an http-only cookie for a day (never in the address bar), and cleared once they sign in.
 */
export const PENDING_EMAIL_COOKIE = 'midan_pending_email';

export async function setPendingEmail(email: string) {
  (await cookies()).set(PENDING_EMAIL_COOKIE, email, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 24 });
}

export async function getPendingEmail(): Promise<string | null> {
  const value = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320 ? value : null;
}
