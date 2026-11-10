// Start MIDAN's web app or API against the Supabase Cloud profile, or only check that profile.
//
//   node scripts/dev-cloud.mjs check|web|api
//
// The profile is .env.cloud when it exists, otherwise .env (the single-file setup in docs/supabase-cloud.md). Either way
// every stack setting must name the Cloud project, through restricted logins with TLS; ambient shell variables can't
// override it (scripts/cloud-env.mjs). "check" validates settings only: it never connects, so it can't prove the
// project is reachable or the credentials work. Values are never printed.
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { CLOUD_AUTH_ORIGIN, cloudChildEnv, validateCloudEnv, withheldSettings } from './cloud-env.mjs';

const mode = process.argv[2];
if (!['check', 'web', 'api'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/dev-cloud.mjs check|web|api');
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const file = existsSync(new URL('../.env.cloud', import.meta.url)) ? '.env.cloud' : '.env';
let profile;
try {
  profile = parseEnv(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
} catch {
  console.error(`Cloud profile check failed: ${file} could not be read`);
  process.exit(1);
}
const result = validateCloudEnv(profile);
if (!result.ok) {
  console.error(`Cloud profile check failed (${file}): ${result.errors.join(', ')}`);
  process.exit(1);
}
const withheld = withheldSettings(profile);
console.log(`Cloud profile settings are valid (${file}): ${CLOUD_AUTH_ORIGIN}. This checks settings only; no connection or credential was tested.`);
if (withheld.length) console.log(`Not passed to any service: ${withheld.join(', ')}`);
if (mode === 'check') process.exit(0);
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', mode === 'web' ? 'dev:web' : 'dev:api'], {
  cwd: root,
  env: cloudChildEnv(profile, process.env),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.once('error', () => {
  console.error(`Cloud development ${mode} could not start.`);
  process.exitCode = 1;
});
child.once('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
