export type ResendLimitResult = { allowed: true } | { allowed: false; retryAfter: number };

/**
 * A bounded process-local backstop, not a distributed quota. Supabase remains authoritative across instances.
 * Callers pass a hash of the normalized email, and consume before making any external request (including failures).
 */
export class ConfirmationResendLimiter {
  private readonly emails = new Map<string, number>();
  private attempts: number[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) throw new Error('Invalid resend limiter capacity');
    this.maxEntries = maxEntries;
  }

  defer(emailHash: string, seconds: number, now = Date.now()): void {
    // Only extend a slot already consumed by this request; never admit arbitrary keys past capacity.
    const previous = this.emails.get(emailHash);
    if (previous !== undefined && Number.isFinite(seconds)) {
      this.emails.set(emailHash, Math.max(previous, now + Math.min(86_400, Math.max(60, seconds)) * 1000));
    }
  }

  consume(emailHash: string, now = Date.now()): ResendLimitResult {
    const windowMs = 60_000;
    for (const [key, expires] of this.emails) if (expires <= now) this.emails.delete(key);
    this.attempts = this.attempts.filter((at) => at + windowMs > now);
    const limitedUntil = this.emails.get(emailHash);
    if (limitedUntil !== undefined) return { allowed: false, retryAfter: Math.max(1, Math.ceil((limitedUntil - now) / 1000)) };
    if (this.attempts.length >= 10) return { allowed: false, retryAfter: Math.max(1, Math.ceil((this.attempts[0] + windowMs - now) / 1000)) };
    if (this.emails.size >= this.maxEntries) {
      // Never evict an active key: that would allow its cooldown to be bypassed under load.
      const firstExpiry = Math.min(...this.emails.values());
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((firstExpiry - now) / 1000)) };
    }
    this.emails.set(emailHash, now + windowMs);
    this.attempts.push(now);
    return { allowed: true };
  }
}
