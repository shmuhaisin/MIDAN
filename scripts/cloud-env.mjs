// Explicit Cloud development profile checks only. Never connect, print values, or read the local test .env.
export const CLOUD_PROJECT_REF = 'squpszwbrqkflezfltoj';
export const CLOUD_AUTH_ORIGIN = `https://${CLOUD_PROJECT_REF}.supabase.co`;

function cloudOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === CLOUD_AUTH_ORIGIN && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

function applicationOrigin(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && local))
      && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

function cloudDatabase(value, role = 'midan_api') {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password || url.pathname !== '/postgres' || url.hash) return false;
    const user = decodeURIComponent(url.username);
    const direct = url.hostname === `db.${CLOUD_PROJECT_REF}.supabase.co` && user === role && (!url.port || url.port === '5432');
    const pooler = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname)
      && user === `${role}.${CLOUD_PROJECT_REF}` && ['5432', '6543'].includes(url.port);
    if (!direct && !pooler) return false;
    // libpq/pg query parameters can override URL connection fields; refuse routing overrides.
    if (['host', 'hostaddr', 'port', 'user', 'password', 'dbname', 'database'].some((key) => url.searchParams.has(key))) return false;
    if (url.searchParams.getAll('sslmode').length !== 1 || !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) return false;
    return !url.searchParams.has('ssl') || ['true', '1'].includes(url.searchParams.get('ssl'));
  } catch { return false; }
}

/** Return setting names on failure; never include configuration values or native URL/parser errors. */
export function validateCloudEnv(profile) {
  const errors = [];
  if (!cloudOrigin(profile.NEXT_PUBLIC_SUPABASE_URL)) errors.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) if (!cloudDatabase(profile[key])) errors.push(key);
  for (const key of ['APP_URL', 'API_URL']) if (!applicationOrigin(profile[key])) errors.push(key);
  if (profile.SUPABASE_URL !== undefined && (!cloudOrigin(profile.SUPABASE_URL) || !cloudOrigin(profile.NEXT_PUBLIC_SUPABASE_URL))) errors.push('SUPABASE_URL');
  if (profile.SUPABASE_PUBLISHABLE_KEY !== undefined && profile.SUPABASE_PUBLISHABLE_KEY !== profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) errors.push('SUPABASE_PUBLISHABLE_KEY');
  if (profile.DEV_TEST_SIGNUP !== undefined && !['true', 'false'].includes(profile.DEV_TEST_SIGNUP)) errors.push('DEV_TEST_SIGNUP');
  if (profile.DEV_TEST_SIGNUP === 'true' && !profile.DEV_TEST_ACCESS_CODE?.trim()) errors.push('DEV_TEST_ACCESS_CODE');
  if (profile.CHECKPOINT_DATABASE_URL && !cloudDatabase(profile.CHECKPOINT_DATABASE_URL, 'midan_ai')) errors.push('CHECKPOINT_DATABASE_URL');
  return { ok: errors.length === 0, errors };
}

/** Known stack settings override ambient variables even when an optional profile value is absent. */
export function cloudChildEnv(profile, inherited = {}) {
  const result = validateCloudEnv(profile);
  if (!result.ok) throw new Error(`Invalid Cloud profile settings: ${result.errors.join(', ')}`);
  return {
    ...inherited,
    ...profile,
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_AUTH_ORIGIN,
    SUPABASE_URL: CLOUD_AUTH_ORIGIN,
    SUPABASE_PUBLISHABLE_KEY: profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    MIDAN_DIST_DIR: profile.MIDAN_DIST_DIR || '.next-cloud',
    DEV_TEST_SIGNUP: profile.DEV_TEST_SIGNUP ?? 'false',
    DEV_TEST_ACCESS_CODE: profile.DEV_TEST_ACCESS_CODE ?? '',
    CHECKPOINT_DATABASE_URL: profile.CHECKPOINT_DATABASE_URL ?? '',
  };
}
