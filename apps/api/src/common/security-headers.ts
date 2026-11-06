import type { NextFunction, Request, Response } from 'express';

/**
 * Headers for every API response. The API only ever answers with JSON, so its content policy allows nothing; the
 * Swagger page at /docs is the exception, since it runs its own scripts and styles. HSTS is sent only over HTTPS
 * (req.secure, which honours TRUST_PROXY for a TLS-terminating proxy), where it can't lock a plain-HTTP setup out.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!req.path.startsWith('/docs')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
