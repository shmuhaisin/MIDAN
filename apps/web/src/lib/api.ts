import 'server-only';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccessToken } from './session';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API responded ${status}`);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${process.env.API_URL}/v1${path}`, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(init?.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

/** For pages: an ended session goes to sign-in, and a missing or forbidden page returns null. */
export async function apiForPage<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect({ href: '/login', locale: await getLocale() });
    }
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

export function errorCode(error: unknown) {
  if (error instanceof ApiError) {
    const codes: Record<number, string> = {
      400: 'required', 401: 'session', 403: 'forbidden', 404: 'not_found', 409: 'duplicate', 422: 'not_allowed', 429: 'over_request_rate_limit',
    };
    return codes[error.status] ?? 'generic';
  }
  return 'unavailable';
}
