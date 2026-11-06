import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { authenticate } from '../auth/auth.guard';

/**
 * Traffic arrives through the Next.js server, so one IP can mean many people.
 * Verified callers are limited per account, everyone else per IP. Only a token Supabase Auth accepts earns its own
 * limit: keying on the raw header would give every made-up token a fresh one.
 */
@Injectable()
export class TokenThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request) {
    const user = await authenticate(req).catch(() => null);
    return user ? `user:${user.id}` : (req.ip ?? 'unknown');
  }
}
