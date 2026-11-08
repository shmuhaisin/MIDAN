// Browser and form tests write data through the local API, so they refuse a .env that points anywhere else. Settings are
// named, never printed. The same rule as apps/api/src/common/local-stack.ts.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const SETTINGS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'DATABASE_URL', 'DIRECT_URL', 'CHECKPOINT_DATABASE_URL', 'API_URL', 'AI_SERVICE_URL', 'APP_URL'];
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertLocalStack(root = resolve(__dirname, '../../..')) {
  const env: Record<string, string | undefined> = {};
  for (const f of ['.env', '.env.test.local']) if (existsSync(resolve(root, f))) Object.assign(env, parseEnv(readFileSync(resolve(root, f), 'utf8')));
  Object.assign(env, Object.fromEntries(SETTINGS.filter((k) => process.env[k]).map((k) => [k, process.env[k]])));
  const outside = SETTINGS.filter((k) => {
    if (!env[k]) return false;
    try { return !LOCAL.has(new URL(env[k] as string).hostname); } catch { return true; }
  });
  if (outside.length) throw new Error(`Refusing to run: these settings point outside the local stack: ${outside.join(', ')}. Tests write data; use the local .env.`);
}
