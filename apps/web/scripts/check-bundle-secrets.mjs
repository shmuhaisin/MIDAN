// Checks a production build for server-only secrets. Fails if
//   - the value of a secret appears anywhere in the build (browser files or server files), or
//   - a secret's name, or the sign-up field that carries the code, appears in what browsers download.
// Build with a recognisable value first, then check:
//
//   DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run build -w @midan/web
//   DEV_TEST_ACCESS_CODE=bundle-canary-7f3a node apps/web/scripts/check-bundle-secrets.mjs apps/web/.next
//
// The distDir argument defaults to .next next to this folder.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRETS = ['DEV_TEST_ACCESS_CODE', 'AI_SERVICE_TOKEN', 'DATABASE_URL', 'DIRECT_URL', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'DAILY_API_KEY', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN'];
const BROWSER_NAMES = [...SECRETS, 'midan_test_access'];

const dist = process.argv[2] ?? fileURLToPath(new URL('../.next', import.meta.url));
const values = SECRETS.map((name) => [name, process.env[name]]).filter(([, value]) => value && value.length >= 8);
if (!values.length) console.warn('No secret values are set, so only names are checked. Build and check with DEV_TEST_ACCESS_CODE set.');

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'cache') yield* files(path);
    } else if (/\.(js|mjs|cjs|json|html|rsc|txt|map|css)$/.test(entry)) {
      yield path;
    }
  }
}

const problems = [];
let scanned = 0;
for (const file of files(dist)) {
  scanned++;
  const text = readFileSync(file, 'utf8');
  const browser = file.includes(`${join(dist, 'static')}`);
  for (const [name, value] of values) if (text.includes(value)) problems.push(`${file}: the value of ${name}`);
  if (browser) for (const name of BROWSER_NAMES) if (text.includes(name)) problems.push(`${file}: the name ${name}, in a browser file`);
}

if (!scanned) {
  console.error(`No build files under ${dist}. Build first.`);
  process.exit(2);
}
if (problems.length) {
  console.error(`Secrets found in the build:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Checked ${scanned} build files: no secret values${values.length ? ` (${values.map(([n]) => n).join(', ')})` : ''}, and no secret names in browser files.`);
