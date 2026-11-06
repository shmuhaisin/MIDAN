import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp, trustProxySetting } from './common/configure-app';

const LIMIT = 300;

describe('rate limiting', () => {
  let app: INestApplication;
  const env = { ...process.env };

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://auth.test';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    // Supabase Auth stand-in: only "Bearer valid-<id>" is a real session.
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const token = String(new Headers(init?.headers).get('authorization'));
      const id = token.match(/^Bearer valid-(.+)$/)?.[1];
      return id ? Response.json({ id, email: `${id}@example.com` }) : new Response('{}', { status: 401 });
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
    process.env = env;
  });

  async function start(trustProxy?: string) {
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }

  afterEach(() => app.close());

  const health = (headers: Record<string, string> = {}) => request(app.getHttpServer()).get('/health').set(headers);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const from = (ip: string) => ({ 'x-forwarded-for': ip });

  it('refuses a caller with no token who exceeds the limit', async () => {
    await start();
    for (let i = 0; i < LIMIT; i++) await health().expect(200);
    await health().expect(429);
  });

  it('gives made-up tokens no limit of their own: they count against the address', async () => {
    await start();
    for (let i = 0; i < LIMIT; i++) await health(bearer(`forged-${i}`)).expect(200);
    await health(bearer(`forged-${LIMIT}`)).expect(429);
    await health().expect(429);
  });

  it('limits a verified account by account, apart from its address', async () => {
    await start();
    for (let i = 0; i < LIMIT; i++) await health(bearer('valid-one')).expect(200);
    await health(bearer('valid-one')).expect(429);
    await health(bearer('valid-two')).expect(200);
    await health().expect(200);
  });

  it('limits each client address separately behind a trusted proxy', async () => {
    await start('1');
    for (let i = 0; i < LIMIT; i++) await health(from('203.0.113.1')).expect(200);
    await health(from('203.0.113.1')).expect(429);
    await health(from('203.0.113.2')).expect(200);
    // Behind the trusted hop, only the address it appended counts; whatever the client wrote before it doesn't.
    await health(from('198.51.100.7, 203.0.113.1')).expect(429);
  });

  it('ignores a forwarded address when no proxy is trusted, so it cannot be used to dodge the limit', async () => {
    await start();
    for (let i = 0; i < LIMIT; i++) await health(from(`203.0.113.${i % 250}`)).expect(200);
    await health(from('198.51.100.7')).expect(429);
  });
});

describe('trusted proxy setting', () => {
  it('is off unless set', () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('0')).toBe(false);
  });

  it('takes a hop count, or addresses and names Express understands', () => {
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting(' 2 ')).toBe(2);
    expect(trustProxySetting('loopback')).toBe('loopback');
    expect(trustProxySetting('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
  });
});
