import { CanActivate, createParamDecorator, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../db/db.service';

type AuthedRequest = Request & { user?: AuthUser };

/** Verifies the Supabase access token with Supabase Auth, which also catches revoked sessions. */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!base || !apikey) throw new ServiceUnavailableException('Authentication is not configured');

    const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey, authorization: header } });
    if (response.status >= 500) throw new ServiceUnavailableException('Authentication is unavailable');
    if (!response.ok) throw new UnauthorizedException();

    const { id, email } = (await response.json()) as AuthUser;
    request.user = { id, email };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().user as AuthUser,
);
