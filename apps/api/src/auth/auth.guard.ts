import { CanActivate, createParamDecorator, ExecutionContext, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../db/db.service';

type AuthedRequest = Request & { user?: AuthUser; verified?: Promise<AuthUser | null> };

/**
 * Verifies the request's Supabase access token with Supabase Auth, which also catches revoked sessions. Resolves to null
 * for a missing or rejected token. Done once per request: the rate limiter and the guards share the answer.
 */
export function authenticate(request: AuthedRequest): Promise<AuthUser | null> {
  request.verified ??= verify(request.headers.authorization, request.ip ?? 'unknown');
  return request.verified;
}

// The rate limiter needs to know who is calling before it can count them, so a made-up token reaches Supabase Auth even
// past the limit. An address that keeps sending rejected tokens stops being passed on, or it could get this API limited
// at Auth for everyone. Per process, like the rate limiter.
const MAX_FAILED_CHECKS = 60;
const FAILED_CHECK_WINDOW_MS = 60_000;
const failedChecks = new Map<string, { count: number; resetAt: number }>();

function recordFailedCheck(address: string) {
  const now = Date.now();
  if (failedChecks.size >= 10_000) {
    for (const [key, entry] of failedChecks) if (entry.resetAt <= now) failedChecks.delete(key);
    if (failedChecks.size >= 10_000) failedChecks.clear();
  }
  const entry = failedChecks.get(address);
  if (entry && entry.resetAt > now) entry.count += 1;
  else failedChecks.set(address, { count: 1, resetAt: now + FAILED_CHECK_WINDOW_MS });
}

function tooManyFailedChecks(address: string) {
  const entry = failedChecks.get(address);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILED_CHECKS);
}

export function resetFailedChecks() {
  failedChecks.clear();
}

async function verify(header: string | undefined, address: string): Promise<AuthUser | null> {
  if (!header?.startsWith('Bearer ')) return null;
  // Not "signed out": a real session behind the same address shouldn't lose its cookies over someone else's traffic.
  if (tooManyFailedChecks(address)) throw new HttpException('Too many rejected tokens', HttpStatus.TOO_MANY_REQUESTS);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !apikey) throw new ServiceUnavailableException('Authentication is not configured');

  // An error from fetch can hold the raw request, token included, so it goes no further than this.
  const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey, authorization: header } }).catch(() => null);
  if (!response) throw new ServiceUnavailableException('Authentication is unavailable');
  if (response.status >= 500) throw new ServiceUnavailableException('Authentication is unavailable');
  if (!response.ok) {
    recordFailedCheck(address);
    return null;
  }
  const { id, email } = (await response.json()) as AuthUser;
  return { id, email };
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await authenticate(request);
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}

/** For public routes that show a little more to a verified account. A missing or bad token just means signed out. */
@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  async canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<AuthedRequest>().headers.authorization) {
      await super.canActivate(context).catch(() => undefined);
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().user as AuthUser,
);
