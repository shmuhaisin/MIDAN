import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from './configure-app';

describe('API security headers', () => {
  let app: INestApplication;
  const env = { ...process.env };

  async function start(trustProxy?: string) {
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }

  afterEach(() => app.close());
  afterAll(() => {
    process.env = env;
  });

  it('sends a content policy that allows nothing, and no framing, sniffing or referrer', async () => {
    await start();
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends HSTS only over HTTPS, as reported by a trusted proxy', async () => {
    await start();
    expect((await request(app.getHttpServer()).get('/health').set('x-forwarded-proto', 'https')).headers['strict-transport-security']).toBeUndefined();
    await app.close();
    await start('1');
    const secure = await request(app.getHttpServer()).get('/health').set('x-forwarded-proto', 'https');
    expect(secure.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect((await request(app.getHttpServer()).get('/health')).headers['strict-transport-security']).toBeUndefined();
  });
});
