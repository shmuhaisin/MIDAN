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
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}
