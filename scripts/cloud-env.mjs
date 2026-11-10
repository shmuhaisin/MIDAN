// Checks for the explicit Supabase Cloud development profile. Never connects, never prints a value: failures name the
// setting only. Ported from fix/midan-employer-access-authorization with these changes: ambient stack settings (including
// libpq's PG* variables) can't leak into the services, privileged connection strings are withheld from them, every
// stack setting is set explicitly so the services' own .env loading can't fill a gap from a local file, and the Cloud
// build directory can never be the local one.
export const CLOUD_PROJECT_REF = 'squpszwbrqkflezfltoj';
export const CLOUD_AUTH_ORIGIN = `https://${CLOUD_PROJECT_REF}.supabase.co`;
export const LOCAL_DIST_DIR = '.next';
export const CLOUD_DIST_DIR = '.next-cloud';

/** Database settings a service may receive, and the restricted role each must log in as. */
const SERVICE_DATABASES = { DATABASE_URL: 'midan_api', DIRECT_URL: 'midan_api', CHECKPOINT_DATABASE_URL: 'midan_ai' };

/**
 * Environment names that select a stack: they come from the profile or nowhere. Inherited values are dropped, so a shell
 * with a local DATABASE_URL, a PGHOST or a LOCAL_PG_PORT can't redirect a Cloud run.
 */
const STACK_SETTING = /^(?:NEXT_PUBLIC_SUPABASE_\w+|SUPABASE_\w+|\w*DATABASE_URL|DIRECT_URL|LOCAL_\w+|DEV_TEST_\w+|TEST_\w+|MIDAN_DIST_DIR|API_URL|APP_URL|AI_SERVICE_URL|AI_SERVICE_TOKEN|PG(?:HOST|HOSTADDR|PORT|USER|PASSWORD|DATABASE|SSLMODE|SSLROOTCERT|SERVICE|SERVICEFILE|PASSFILE|OPTIONS|TARGETSESSIONATTRS))$/;

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

function cloudDatabase(value, role) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password || url.pathname !== '/postgres' || url.hash) return false;
    const user = decodeURIComponent(url.username);
    const direct = url.hostname === `db.${CLOUD_PROJECT_REF}.supabase.co` && user === role && (!url.port || url.port === '5432');
    const pooler = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname)
      && user === `${role}.${CLOUD_PROJECT_REF}` && ['5432', '6543'].includes(url.port);
    if (!direct && !pooler) return false;
    // libpq/pg query parameters can override URL connection fields; refuse routing overrides.
    if (['host', 'hostaddr', 'port', 'user', 'password', 'dbname', 'database', 'service', 'options'].some((key) => url.searchParams.has(key))) return false;
    if (url.searchParams.getAll('sslmode').length !== 1 || !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) return false;
    return !url.searchParams.has('ssl') || ['true', '1'].includes(url.searchParams.get('ssl'));
  } catch { return false; }
}

/** Connection strings in the profile that no service receives (MIGRATION_DATABASE_URL and the like): names only. */
export function withheldSettings(profile) {
  return Object.keys(profile).filter((key) => /DATABASE_URL$/.test(key) && !(key in SERVICE_DATABASES)).sort();
}

/** Return setting names on failure; never include configuration values or native URL/parser errors. */
export function validateCloudEnv(profile) {
  const errors = [];
  if (!cloudOrigin(profile.NEXT_PUBLIC_SUPABASE_URL)) errors.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || /^sb_secret_/.test(profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim())) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) if (!cloudDatabase(profile[key], SERVICE_DATABASES[key])) errors.push(key);
  for (const key of ['APP_URL', 'API_URL']) if (!applicationOrigin(profile[key])) errors.push(key);
  if (profile.AI_SERVICE_URL !== undefined && !applicationOrigin(profile.AI_SERVICE_URL)) errors.push('AI_SERVICE_URL');
  if (profile.SUPABASE_URL !== undefined && (!cloudOrigin(profile.SUPABASE_URL) || !cloudOrigin(profile.NEXT_PUBLIC_SUPABASE_URL))) errors.push('SUPABASE_URL');
  if (profile.SUPABASE_PUBLISHABLE_KEY !== undefined && profile.SUPABASE_PUBLISHABLE_KEY !== profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) errors.push('SUPABASE_PUBLISHABLE_KEY');
  if (profile.DEV_TEST_SIGNUP !== undefined && !['true', 'false'].includes(profile.DEV_TEST_SIGNUP)) errors.push('DEV_TEST_SIGNUP');
  if (profile.DEV_TEST_SIGNUP === 'true' && !profile.DEV_TEST_ACCESS_CODE?.trim()) errors.push('DEV_TEST_ACCESS_CODE');
  if (profile.CHECKPOINT_DATABASE_URL && !cloudDatabase(profile.CHECKPOINT_DATABASE_URL, SERVICE_DATABASES.CHECKPOINT_DATABASE_URL)) errors.push('CHECKPOINT_DATABASE_URL');
  // The local stack builds into .next; a Cloud build there would serve one stack's pages with the other's settings.
  if (profile.MIDAN_DIST_DIR !== undefined && (!/^\.next-[a-z0-9-]+$/.test(profile.MIDAN_DIST_DIR) || profile.MIDAN_DIST_DIR === LOCAL_DIST_DIR)) errors.push('MIDAN_DIST_DIR');
  return { ok: errors.length === 0, errors };
}

/** The services' environment: inherited non-stack settings, then the profile, then the stack settings forced. */
export function cloudChildEnv(profile, inherited = {}) {
  const result = validateCloudEnv(profile);
  if (!result.ok) throw new Error(`Invalid Cloud profile settings: ${result.errors.join(', ')}`);
  const base = Object.fromEntries(Object.entries(inherited).filter(([key]) => !STACK_SETTING.test(key)));
  // Empty, not absent: the API and web app fill only unset variables from the root .env (load-env.ts, next.config.ts).
  const withheld = Object.fromEntries(withheldSettings(profile).map((key) => [key, '']));
  return {
    ...base,
    ...profile,
    ...withheld,
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_AUTH_ORIGIN,
    SUPABASE_URL: CLOUD_AUTH_ORIGIN,
    SUPABASE_PUBLISHABLE_KEY: profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    MIDAN_DIST_DIR: profile.MIDAN_DIST_DIR || CLOUD_DIST_DIR,
    DEV_TEST_SIGNUP: profile.DEV_TEST_SIGNUP ?? 'false',
    DEV_TEST_ACCESS_CODE: profile.DEV_TEST_ACCESS_CODE ?? '',
    CHECKPOINT_DATABASE_URL: profile.CHECKPOINT_DATABASE_URL ?? '',
    MIGRATION_DATABASE_URL: '',
    IMPORT_DATABASE_URL: '',
  };
}
