import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/next-path';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

/**
 * Where a page sends someone whose session the API no longer accepts (expired, revoked, or not a real token). Pages
 * can't change cookies, so this clears them and continues to sign-in; otherwise sign-in would see the stale cookie and
 * send the person straight back. The API is asked first, so a link to this address can't sign out a valid session.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const base = process.env.APP_URL ?? request.nextUrl.origin;
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (token) {
    const check = await fetch(`${process.env.API_URL}/v1/me`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    // Still valid, or the API can't tell right now: keep the session.
    if (!check || check.status !== 401) return NextResponse.redirect(`${base}/${locale}${next ?? '/dashboard'}`);
  }
  const login = new URL(`${base}/${locale}/login`);
  if (next && next !== '/dashboard') login.searchParams.set('next', next);
  const response = NextResponse.redirect(login);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
