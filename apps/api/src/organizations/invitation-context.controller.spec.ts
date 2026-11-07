import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ThrottlerModule } from '@nestjs/throttler';
import { InvitationContextController } from './invitation-context.controller';
import { DbService } from '../db/db.service';
import { configureApp } from '../common/configure-app';

describe('invitation context HTTP contract', () => {
  let app: INestApplication;
  const query = jest.fn().mockResolvedValue([{ expires_at: new Date('2026-11-14T00:00:00Z') }]);
  const asAnon = jest.fn(async (fn: (tx: { $queryRaw: typeof query }) => unknown) => fn({ $queryRaw: query }));
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])], controllers: [InvitationContextController], providers: [{ provide: DbService, useValue: { asAnon } }] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
  });
  afterAll(() => app.close());
  it('accepts token proof in a POST body and returns only expiry', async () => {
    const result = await request(app.getHttpServer()).post('/invitations/context').send({ token: 'a'.repeat(43), email: 'local@example.com' }).expect(201);
    expect(Object.keys(result.body)).toEqual(['expires_at']); expect(asAnon).toHaveBeenCalled();
  });
  it('rejects invalid token, email, or extra fields before any query', async () => {
    query.mockClear();
    for (const body of [{ token: 'invalid' }, { token: 'a'.repeat(43), email: 'bad' }, { token: 'a'.repeat(43), accepted_at: 'now' }]) await request(app.getHttpServer()).post('/invitations/context').send(body).expect(400);
    expect(query).not.toHaveBeenCalled();
  });
});
