import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Traffic arrives through the Next.js server, so one IP can mean many people.
 * Signed-in callers are limited per token, everyone else per IP.
 */
@Injectable()
export class TokenThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request) {
    const token = req.headers.authorization;
    return token ? createHash('sha256').update(token).digest('hex') : (req.ip ?? 'unknown');
  }
}
