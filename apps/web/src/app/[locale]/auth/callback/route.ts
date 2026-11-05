import { NextResponse, type NextRequest } from 'next/server';
import { homeFor } from '@/lib/home';
import { safeNext } from '@/lib/next-path';
import { COOKIE_OPTIONS, decodeToken } from '@/lib/session';

/** Google sends people back here. The one-time code only works with the verifier this browser holds. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const base = process.env.APP_URL ?? request.nextUrl.origin;
  const failed = (code: string) => NextResponse.redirect(`${base}/${locale}/login?error=${code}`);
  const code = request.nextUrl.searchParams.get('code');
  const verifier = request.cookies.get('midan_pkce')?.value;
  if (!code || !verifier) {
    // The database refuses new accounts while registration is closed, and Auth reports that as a failed exchange.
    return failed(request.nextUrl.searchParams.get('error') ? 'registration_closed' : 'google_failed');
  }
  let session: { access_token: string; refresh_token: string };
  try {
    const exchange = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      cache: 'no-store',
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY as string, 'content-type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!exchange.ok) return failed('google_failed');
    session = await exchange.json();
  } catch {
    return failed('unavailable');
  }
  const next = safeNext(request.cookies.get('midan_next')?.value) ?? (await homeFor(decodeToken(session.access_token)?.accountType, session.access_token));
  const response = NextResponse.redirect(`${base}/${locale}${next}`);
  const year = 60 * 60 * 24 * 365;
  response.cookies.set('midan_at', session.access_token, { ...COOKIE_OPTIONS, maxAge: year });
  response.cookies.set('midan_rt', session.refresh_token, { ...COOKIE_OPTIONS, maxAge: year });
  response.cookies.delete('midan_pkce');
  response.cookies.delete('midan_next');
  return response;
}
