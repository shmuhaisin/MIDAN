// LOCAL DEVELOPMENT ONLY. The ports of the local stack, in one place, so every script agrees on them.
//
// Each comes from the environment, then from the repository's .env (scripts/local-env.mjs writes them there), then from
// the default below. Change one when another program already uses it, for example a second MIDAN checkout or another
// PostgreSQL installation:
//
//   LOCAL_PG_PORT        54323  PostgreSQL (scripts/local-db.sh)
//   LOCAL_SUPABASE_PORT  54321  the gateway: Auth, Data API, Storage, mail list (NEXT_PUBLIC_SUPABASE_URL)
//   LOCAL_SMTP_PORT      54326  the mail sink; Supabase Auth sends its emails here
//   LOCAL_AUTH_PORT      54329  Supabase Auth itself (behind the gateway)
//   LOCAL_REST_PORT      54328  PostgREST itself (behind the gateway)
//
// Nothing here is used by a hosted environment.
import { existsSync, readFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const PORT_DEFAULTS = {
  LOCAL_PG_PORT: 54323,
  LOCAL_SUPABASE_PORT: 54321,
  LOCAL_SMTP_PORT: 54326,
  LOCAL_AUTH_PORT: 54329,
  LOCAL_REST_PORT: 54328,
};

const fromFile = (() => {
  try {
    return existsSync(`${ROOT}.env`) ? parseEnv(readFileSync(`${ROOT}.env`, 'utf8')) : {};
  } catch {
    return {};
  }
})();

/** One port: environment, then .env, then the default. Refuses anything that isn't a usable TCP port. */
export function portSetting(name, env = process.env, file = fromFile) {
  const raw = env[name] || file[name] || String(PORT_DEFAULTS[name]);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${name} must be a port number from 1024 to 65535 (got "${raw}")`);
  return port;
}

export function localPorts(env = process.env, file = fromFile) {
  const ports = {
    pg: portSetting('LOCAL_PG_PORT', env, file),
    supabase: portSetting('LOCAL_SUPABASE_PORT', env, file),
    smtp: portSetting('LOCAL_SMTP_PORT', env, file),
    auth: portSetting('LOCAL_AUTH_PORT', env, file),
    rest: portSetting('LOCAL_REST_PORT', env, file),
  };
  const seen = new Map();
  for (const [role, port] of Object.entries(ports)) {
    if (seen.has(port)) throw new Error(`${role} and ${seen.get(port)} are both set to port ${port}; give each its own port`);
    seen.set(port, role);
  }
  return ports;
}

export const PORTS = localPorts();
export const SUPABASE_URL = `http://localhost:${PORTS.supabase}`;

/** Whether something answers on 127.0.0.1:port (a connection is opened and closed at once). */
export function isListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(700, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Whether a port can be used: nothing answers on it, and a listener can be opened there (then closed at once). Both,
 * because on Windows a listener on 127.0.0.1 can open beside another program's listener on 0.0.0.0. Never touches the
 * other program.
 */
export async function isPortFree(port, host = '127.0.0.1') {
  if (await isListening(port, host)) return false;
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (error) => resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES'));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** Who holds a port, for the message only (Windows: netstat + the process's command line). Read-only; null when unknown. */
export function portOwner(port) {
  if (process.platform !== 'win32') return null;
  try {
    const line = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
      .split(/\r?\n/).find((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l));
    const pid = line?.trim().split(/\s+/).at(-1);
    if (!pid || !/^\d+$/.test(pid)) return null;
    let command = '';
    try {
      command = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: 'utf8' }).trim();
    } catch { /* the PID is still useful */ }
    return { pid, command };
  } catch {
    return null;
  }
}

/**
 * Before starting: every port the gateway will open must be free, and PostgreSQL must already answer on its port.
 * Reports each problem with what uses the port and how to choose another. Stops nothing.
 */
export async function preflight(ports = PORTS, { log = console.error } = {}) {
  const wanted = [
    ['LOCAL_SUPABASE_PORT', ports.supabase, 'the gateway (Auth, Data API, Storage, mail list)'],
    ['LOCAL_SMTP_PORT', ports.smtp, 'the mail sink Supabase Auth sends to'],
    ['LOCAL_AUTH_PORT', ports.auth, 'Supabase Auth'],
    ['LOCAL_REST_PORT', ports.rest, 'PostgREST'],
  ];
  const problems = [];
  for (const [name, port, role] of wanted) {
    if (await isPortFree(port)) continue;
    const owner = portOwner(port);
    problems.push(`  port ${port} (${name}, ${role}) is already in use${owner ? ` by PID ${owner.pid}${owner.command ? `: ${owner.command}` : ''}` : ''}`);
  }
  if (!(await isListening(ports.pg))) {
    problems.push(`  nothing listens on port ${ports.pg} (LOCAL_PG_PORT): start PostgreSQL first with scripts/local-db.sh start, or set LOCAL_PG_PORT to MIDAN's database`);
  }
  if (problems.length === 0) return true;
  log(`Local Supabase can't start:\n${problems.join('\n')}\n` +
    'Nothing was stopped. Either stop that program yourself (if it is an earlier run of this script, end that run),\n' +
    'or choose free ports, for example in Git Bash: LOCAL_SUPABASE_PORT=54331 LOCAL_SMTP_PORT=54336 node scripts/local-supabase.mjs\n' +
    '(then run node scripts/local-env.mjs --force with the same settings, so .env and the app use them too).');
  return false;
}
