import { CanActivate, createParamDecorator, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../db/db.service';

type AuthedRequest = Request & { user?: AuthUser; verified?: Promise<AuthUser | null> };

/**
 * Verifies the request's Supabase access token with Supabase Auth, which also catches revoked sessions. Resolves to null
 * for a missing or rejected token. Done once per request: the rate limiter and the guards share the answer.
 */
export function authenticate(request: AuthedRequest): Promise<AuthUser | null> {
  request.verified ??= verify(request.headers.authorization);
  return request.verified;
}

async function verify(header: string | undefined): Promise<AuthUser | null> {
  if (!header?.startsWith('Bearer ')) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !apikey) throw new ServiceUnavailableException('Authentication is not configured');

  const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey, authorization: header } });
  if (response.status >= 500) throw new ServiceUnavailableException('Authentication is unavailable');
  if (!response.ok) return null;
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
