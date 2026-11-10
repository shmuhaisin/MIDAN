// Start MIDAN against its explicit Cloud profile; local test .env files are never the source of stack settings.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { CLOUD_AUTH_ORIGIN, cloudChildEnv, validateCloudEnv } from './cloud-env.mjs';

const mode = process.argv[2];
if (!['check', 'web', 'api'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/dev-cloud.mjs check|web|api');
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
let profile;
try {
  profile = parseEnv(readFileSync(new URL('../.env.cloud', import.meta.url), 'utf8'));
} catch {
  console.error('Cloud profile check failed: .env.cloud');
  process.exit(1);
}
const result = validateCloudEnv(profile);
if (!result.ok) {
  console.error(`Cloud profile check failed: ${result.errors.join(', ')}`);
  process.exit(1);
}
console.log(`Cloud profile checks passed: ${CLOUD_AUTH_ORIGIN}. Network access and credentials are not tested.`);
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
