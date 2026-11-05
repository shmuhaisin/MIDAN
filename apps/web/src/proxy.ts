import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);
const ACCESS = 'midan_at';
const REFRESH = 'midan_rt';
const COOKIE = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 } as const;

function expiresSoon(token: string) {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

const PRIVATE = /^\/(ar|en)\/(dashboard|onboarding|profile|applications|interviews|development|notifications|settings|reports|experience|organization)(\/|$)/;

/** Renews an expiring session on page loads, then reloads so the page sees the new cookies. */
export default async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS)?.value;
  const refresh = request.cookies.get(REFRESH)?.value;
  if (request.method === 'GET' && refresh && (!access || expiresSoon(access))) {
    const response = NextResponse.redirect(request.nextUrl);
    try {
      const result = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (result.ok) {
        const data = await result.json();
        response.cookies.set(ACCESS, data.access_token, COOKIE);
        response.cookies.set(REFRESH, data.refresh_token, COOKIE);
      } else {
        response.cookies.delete(ACCESS);
        response.cookies.delete(REFRESH);
      }
      return response;
    } catch {
      // Supabase unreachable: carry on, and the API will treat the session as ended if it must.
    }
  }
  // Signed out, a private page goes to sign-in and remembers where it was headed.
  if (request.method === 'GET' && !access && !refresh && PRIVATE.test(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone();
    const locale = request.nextUrl.pathname.split('/')[1];
    login.pathname = `/${locale}/login`;
    login.search = '';
    const next = request.nextUrl.pathname.slice(locale.length + 1) + request.nextUrl.search;
    if (next !== '/dashboard') login.searchParams.set('next', next);
    return NextResponse.redirect(login);
  }
  return intl(request);
}

export const config = { matcher: '/((?!_next|_vercel|.*\\..*).*)' };
