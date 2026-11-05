import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// File sizes are bigint columns, and JSON has no bigint.
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function (this: bigint) {
  return Number(this);
};

export type AuthUser = { id: string; email: string };
export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export function isExpiredTransaction(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
}

/**
 * The only way to reach the database. The midan_api login has no table access of its own, so
 * every query runs in a transaction that assumes the caller's role and identity, and RLS applies.
 */
@Injectable()
export class DbService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);

  asUser<T>(user: AuthUser, work: (tx: Tx) => Promise<T>): Promise<T> {
    const claims = JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' });
    return this.withRetry(() =>
      this.$transaction(async (tx) => {
        await tx.$queryRaw`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true)`;
        return work(tx);
      }, TX_OPTIONS),
    );
  }

  asAnon<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withRetry(() =>
      this.$transaction(async (tx) => {
        await tx.$queryRaw`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`;
        return work(tx);
      }, TX_OPTIONS),
    );
  }

  /**
   * The connection pooler occasionally stalls long enough for a transaction to expire. An expired
   * transaction has rolled back, so running it once more is safe. Keep transaction callbacks to
   * database work for this reason: calls to other services belong outside them.
   */
  async withRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isExpiredTransaction(error)) throw error;
      this.logger.warn('A database transaction expired. Retrying once.');
      return run();
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
