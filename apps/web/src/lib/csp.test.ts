import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentSecurityPolicy, newNonce } from './csp.ts';

const parse = (policy: string) => new Map(policy.split('; ').map((d) => { const [name, ...values] = d.split(' '); return [name, values]; }));

test('scripts run only with this request\'s nonce, never inline or from other sites', () => {
  const policy = parse(contentSecurityPolicy({ nonce: 'abc', supabaseUrl: 'https://p.supabase.co' }));
  assert.deepEqual(policy.get('script-src'), ["'self'", "'nonce-abc'", "'strict-dynamic'"]);
  assert.ok(!policy.get('script-src')!.includes("'unsafe-inline'"));
  assert.ok(!policy.get('script-src')!.includes("'unsafe-eval'"));
});

test('the page cannot be framed, and plugins and base rewrites are off', () => {
  const policy = parse(contentSecurityPolicy({ nonce: 'abc' }));
  assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(policy.get('object-src'), ["'none'"]);
  assert.deepEqual(policy.get('base-uri'), ["'self'"]);
});

test('allows what the app uses: Supabase logos and sign-in, and Daily interviews', () => {
  const policy = parse(contentSecurityPolicy({ nonce: 'abc', supabaseUrl: 'https://p.supabase.co/some/path' }));
  assert.ok(policy.get('img-src')!.includes('https://p.supabase.co'));
  assert.ok(policy.get('form-action')!.includes('https://p.supabase.co'));
  // Google sign-in without JavaScript: a form post redirected to Supabase, then Google. Chromium blocks the last hop otherwise.
  assert.ok(policy.get('form-action')!.includes('https://accounts.google.com'));
  assert.deepEqual(policy.get('frame-src'), ['https://*.daily.co']);
});

test('development adds only eval, and HTTPS adds upgrades', () => {
  const dev = parse(contentSecurityPolicy({ nonce: 'abc', dev: true }));
  assert.ok(dev.get('script-src')!.includes("'unsafe-eval'"));
  assert.ok(!dev.has('upgrade-insecure-requests'));
  assert.ok(parse(contentSecurityPolicy({ nonce: 'abc', https: true })).has('upgrade-insecure-requests'));
});

test('a bad Supabase URL is left out rather than breaking the policy', () => {
  const policy = parse(contentSecurityPolicy({ nonce: 'abc', supabaseUrl: 'not a url' }));
  assert.deepEqual(policy.get('img-src'), ["'self'", 'data:', 'blob:']);
});

test('every nonce is different', () => {
  assert.notEqual(newNonce(), newNonce());
});
