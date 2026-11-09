#!/usr/bin/env node
// Runs a command with the variables of one env file set in its environment:
//   node scripts/with-env.mjs .env.cloud -- npx next start -p 3100
// Each MIDAN service lets variables already in its environment win over the root .env (apps/api/src/common/load-env.ts,
// apps/web/next.config.ts), so this picks the environment for a whole service without editing or copying .env. No value
// is printed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [file, sep, cmd, ...args] = process.argv.slice(2);
if (!file || sep !== '--' || !cmd) {
  console.error('usage: node scripts/with-env.mjs <env file> -- <command> [args...]');
  process.exit(2);
}
const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...parseEnv(readFileSync(file, 'utf8')) } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
