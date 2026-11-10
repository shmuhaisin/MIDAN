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

/** A request the API didn't answer in time. Without a limit, a stalled API would leave a form spinning forever. */
export class ApiTimeout extends Error {
  constructor(readonly path: string) {
    super(`The API did not answer within the time limit (${path})`);
  }
}

/**
 * How long a request may take before the person is told so. Reads are quick; writes can wait on the AI service
 * (generation, analysis), so they get longer. A form that knows it's quick passes its own, shorter `timeoutMs`.
 */
const TIMEOUT_MS = { read: 30_000, write: 150_000 };

export async function api<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData; timeoutMs?: number }): Promise<T> {
  const token = await getAccessToken();
  const forwarded = await clientAddress();
  const limit = init?.timeoutMs ?? ((init?.method ?? 'GET') === 'GET' ? TIMEOUT_MS.read : TIMEOUT_MS.write);
  const response = await fetch(`${process.env.API_URL}/v1${path}`, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(limit),
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(forwarded && { 'x-forwarded-for': forwarded }),
      ...(init?.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init?.form ?? (init?.body === undefined ? undefined : JSON.stringify(init.body)),
  }).catch((error: unknown) => {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new ApiTimeout(path);
    throw error;
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    // Validation errors arrive as a list of messages; keep them, so the person sees what was actually wrong.
    const message = typeof body?.message === 'string' ? body.message : Array.isArray(body?.message) ? body.message.filter((m) => typeof m === 'string').join('; ') : undefined;
    throw new ApiError(response.status, message || undefined);
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
  if (error instanceof ApiTimeout) return 'timeout';
  if (error instanceof ApiError) {
    const codes: Record<number, string> = {
      400: 'required', 401: 'session', 403: 'forbidden', 404: 'not_found', 409: 'duplicate', 413: 'too_large', 422: 'not_allowed', 429: 'over_request_rate_limit', 503: 'unavailable',
    };
    return codes[error.status] ?? 'generic';
  }
  return 'unavailable';
}

/** What the API said, for the person to read beside the translated message. Never a stack trace or an internal address. */
export function errorDetail(error: unknown): string | undefined {
  if (error instanceof ApiError && error.detail && (error.status < 500 || error.status === 503)) return error.detail.slice(0, 300);
  return undefined;
}
