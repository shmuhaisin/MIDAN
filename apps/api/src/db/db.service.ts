import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type AuthUser = { id: string; email: string };
export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/**
 * The only way to reach the database. The midan_api login has no table access of its own, so
 * every query runs in a transaction that assumes the caller's role and identity, and RLS applies.
 */
@Injectable()
export class DbService extends PrismaClient implements OnModuleDestroy {
  asUser<T>(user: AuthUser, work: (tx: Tx) => Promise<T>): Promise<T> {
    const claims = JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' });
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true)`;
      return work(tx);
    }, TX_OPTIONS);
  }

  asAnon<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      return work(tx);
    }, TX_OPTIONS);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
