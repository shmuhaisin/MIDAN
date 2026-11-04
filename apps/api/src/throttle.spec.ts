import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';

describe('rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('refuses a caller who exceeds the limit', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 300; i++) await request(server).get('/health').expect(200);
    await request(server).get('/health').expect(429);
  });
});
