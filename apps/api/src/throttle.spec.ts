import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { resetFailedChecks } from './auth/auth.guard';
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

  afterEach(async () => {
    resetFailedChecks();
    await app.close();
  });

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

  it('stops asking Supabase Auth about an address that keeps sending rejected tokens', async () => {
    await start();
    const asked = global.fetch as jest.Mock;
    asked.mockClear();
    for (let i = 0; i < 100; i++) await health(bearer(`forged-${i}`)).expect(200);
    expect(asked).toHaveBeenCalledTimes(60);
    // A private route says "slow down", not "signed out", so a real session sharing the address keeps its cookies.
    await request(app.getHttpServer()).get('/me').set(bearer('forged-again')).expect(429);
    expect(asked).toHaveBeenCalledTimes(60);
  });

  it('counts rejected tokens per address, so another address is still checked', async () => {
    await start('1');
    const asked = global.fetch as jest.Mock;
    for (let i = 0; i < 60; i++) await health({ ...bearer(`forged-${i}`), ...from('203.0.113.1') }).expect(200);
    asked.mockClear();
    await health({ ...bearer('valid-three'), ...from('203.0.113.2') }).expect(200);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('does not count an Auth outage as rejected tokens', async () => {
    await start();
    const asked = global.fetch as jest.Mock;
    const usual = asked.getMockImplementation();
    asked.mockImplementation(async () => new Response('{}', { status: 503 }));
    try {
      for (let i = 0; i < 70; i++) await health(bearer(`token-${i}`)).expect(200);
      asked.mockClear();
      await request(app.getHttpServer()).get('/me').set(bearer('token-real')).expect(503);
      expect(asked).toHaveBeenCalledTimes(1);
    } finally {
      asked.mockImplementation(usual);
    }
  });

  it('answers 503 when Auth is unreachable, and keeps the token out of the logs', async () => {
    await start();
    const lines: string[] = [];
    const logged = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))));
    const asked = global.fetch as jest.Mock;
    const usual = asked.getMockImplementation();
    asked.mockImplementation(async () => {
      throw new TypeError('fetch failed', { cause: { data: 'authorization: Bearer secret-session-token' } });
    });
    try {
      await request(app.getHttpServer()).get('/me').set(bearer('secret-session-token')).expect(503);
      expect(lines.join('\n')).not.toContain('secret-session-token');
    } finally {
      asked.mockImplementation(usual);
      logged.forEach((spy) => spy.mockRestore());
    }
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
