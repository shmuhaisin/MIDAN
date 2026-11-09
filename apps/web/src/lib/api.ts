import 'server-only';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccessToken } from './session';

export class ApiError extends Error {
  constructor(readonly status: number, readonly detail?: string) {
    super(`API responded ${status}`);
  }
}

/**
 * The browser's address as this server received it, so the API can rate-limit signed-out visitors one by one. The API
 * believes it only with TRUST_PROXY set (see docs/deployment.md); otherwise it counts all of them as this server.
 */
async function clientAddress() {
  try {
    return (await headers()).get('x-forwarded-for') ?? undefined;
  } catch {
    return undefined;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const token = await getAccessToken();
  const forwarded = await clientAddress();
  const response = await fetch(`${process.env.API_URL}/v1${path}`, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(forwarded && { 'x-forwarded-for': forwarded }),
      ...(init?.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init?.form ?? (init?.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new ApiError(response.status, typeof body?.message === 'string' ? body.message : undefined);
  }
  // A lookup that finds nothing answers with an empty body.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** For pages: an ended session goes to sign-in, and a missing or forbidden page returns null. */
export async function apiForPage<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // Through the route that clears the stale cookies: sign-in would otherwise send the person straight back.
      redirect({ href: '/auth/ended', locale: await getLocale() });
    }
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

export function errorCode(error: unknown) {
  if (error instanceof ApiError) {
    const codes: Record<number, string> = {
      400: 'required', 401: 'session', 403: 'forbidden', 404: 'not_found', 409: 'duplicate', 413: 'too_large', 422: 'not_allowed', 429: 'over_request_rate_limit',
    };
    return codes[error.status] ?? 'generic';
  }
  return 'unavailable';
}
