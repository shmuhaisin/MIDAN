import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DatabaseExceptionFilter } from './database-exception.filter';
import { securityHeaders } from './security-headers';
import { UnexpectedErrorFilter } from './unexpected-error.filter';

/**
 * Express "trust proxy": which hops in front of the API may report the caller's address in X-Forwarded-For, which the
 * rate limiter then uses for signed-out traffic. Off unless TRUST_PROXY is set, because a forwarded address from anyone
 * else is whatever the sender chose. Set it only when every hop it names appends the address it received from, for
 * example "1" for the web server alone behind a hosting proxy that appends the client address, "loopback", or a
 * comma-separated list of addresses and CIDR ranges. See docs/deployment.md.
 */
export function trustProxySetting(value = process.env.TRUST_PROXY): number | string | false {
  const setting = value?.trim();
  if (!setting || setting === 'false' || setting === '0') return false;
  return /^\d+$/.test(setting) ? Number(setting) : setting;
}

export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', trustProxySetting());
  express.disable('x-powered-by');
  app.use(securityHeaders);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // The catch-all goes first: Nest tries global filters from last to first.
  app.useGlobalFilters(new UnexpectedErrorFilter(app.get(HttpAdapterHost).httpAdapter), new DatabaseExceptionFilter());
}
