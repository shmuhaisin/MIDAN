/**
 * Test suites write data, so they run against the local stack only (docs/local-development.md). This refuses any address a
 * suite would use that isn't on this machine. It names the setting, never its value, so nothing secret reaches a log.
 */
export const LOCAL_ONLY_SETTINGS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'DATABASE_URL', 'DIRECT_URL', 'CHECKPOINT_DATABASE_URL', 'API_URL', 'AI_SERVICE_URL', 'APP_URL'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function nonLocalSettings(env: Record<string, string | undefined>): string[] {
  return LOCAL_ONLY_SETTINGS.filter((name) => {
    const value = env[name];
    if (!value) return false;
    try {
      return !LOCAL_HOSTS.has(new URL(value).hostname);
    } catch {
      return true;
    }
  });
}

export function assertLocalStack(env: Record<string, string | undefined> = process.env) {
  const outside = nonLocalSettings(env);
  if (outside.length) {
    throw new Error(`Refusing to run: these settings point outside the local stack: ${outside.join(', ')}. Tests write data; use the local .env.`);
  }
}
