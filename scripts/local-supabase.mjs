// LOCAL DEVELOPMENT ONLY. Serves the Supabase URL paths Midan uses, on http://localhost:54321, from local processes:
//
//   /auth/v1/*     the real Supabase Auth server (GoTrue), downloaded by scripts/local-tools.sh
//   /rest/v1/*     the real PostgREST server
//   /storage/v1/*  a local implementation of the Storage endpoints Midan calls. Object rows are written and read as the
//                  caller's database role, so the storage policies in supabase/migrations decide, as on Supabase.
//   SMTP :54325    a mail sink. Emails Auth sends (verification, recovery) are saved to .local/mail as .eml files and
//                  listed at http://localhost:54321/__mail, so the real verification link can be followed locally.
//
//   node scripts/local-supabase.mjs            run everything (Postgres must already be running: scripts/local-db.sh start)
//   node scripts/local-supabase.mjs migrate    only run Auth's own migrations, then exit
//
// The keys and secrets below are fixed, public, local-only values. Nothing here is used by a hosted environment.
import { spawn } from 'node:child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const ROOT = new URL('..', import.meta.url).pathname;
const BIN = join(ROOT, '.local/bin');
const MAIL = join(ROOT, '.local/mail');
const PG_PORT = process.env.LOCAL_PG_PORT ?? '54322';
export const LOCAL = {
  url: 'http://localhost:54321',
  publishableKey: 'sb_publishable_local_development_only',
  jwtSecret: 'local-development-jwt-secret-not-for-any-hosted-use-0001',
};
const AUTH_PORT = 54329;
const REST_PORT = 54328;
const SMTP_PORT = 54325;

// ---- JWT (HS256), the same format Supabase Auth issues ----
const b64url = (input) => Buffer.from(input).toString('base64url');
export function signJwt(payload, secret = LOCAL.jwtSecret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
export function verifyJwt(token, secret = LOCAL.jwtSecret) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const ANON_JWT = signJwt({ role: 'anon', iss: 'supabase-local', iat: 1_700_000_000, exp: 4_000_000_000 });

// ---- Supabase Auth ----
const authEnv = {
  ...process.env,
  GOTRUE_DB_DRIVER: 'postgres',
  DATABASE_URL: `postgres://supabase_auth_admin:local-auth@127.0.0.1:${PG_PORT}/midan?search_path=auth&sslmode=disable`,
  DB_NAMESPACE: 'auth',
  GOTRUE_API_HOST: '127.0.0.1',
  PORT: String(AUTH_PORT),
  API_EXTERNAL_URL: `${LOCAL.url}/auth/v1`,
  GOTRUE_SITE_URL: process.env.APP_URL ?? 'http://localhost:3100',
  GOTRUE_URI_ALLOW_LIST: 'http://localhost:3100/**,http://127.0.0.1:3100/**',
  GOTRUE_JWT_SECRET: LOCAL.jwtSecret,
  GOTRUE_JWT_EXP: process.env.LOCAL_JWT_EXP ?? '3600',
  GOTRUE_JWT_AUD: 'authenticated',
  GOTRUE_JWT_ADMIN_ROLES: 'service_role',
  // Gives new users the authenticated role, as on Supabase (the deprecation notice it logs is harmless).
  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
  GOTRUE_DISABLE_SIGNUP: 'false',
  GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
  // Verification stays on, as hosted: the email lands in the local mail sink.
  GOTRUE_MAILER_AUTOCONFIRM: 'false',
  GOTRUE_SMTP_HOST: '127.0.0.1',
  GOTRUE_SMTP_PORT: String(SMTP_PORT),
  GOTRUE_SMTP_ADMIN_EMAIL: 'no-reply@midan.local',
  GOTRUE_SMTP_SENDER_NAME: 'Midan (local)',
  GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
  GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
  GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000',
  GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '10000',
  GOTRUE_RATE_LIMIT_VERIFY: '10000',
  GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS: '10000',
  GOTRUE_LOG_LEVEL: 'warn',
};

function runAuth(args, options = {}) {
  return spawn(join(BIN, 'auth'), args, { env: authEnv, cwd: BIN, stdio: options.stdio ?? 'inherit' });
}

async function migrateAuth() {
  await new Promise((resolve, reject) => {
    runAuth(['migrate']).on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Auth migrations failed (${code})`))));
  });
}

// ---- Mail sink: the minimum of SMTP that Auth needs ----
function startMailSink() {
  mkdirSync(MAIL, { recursive: true });
  createTcpServer((socket) => {
    let buffer = '';
    let data = false;
    let message = '';
    const say = (line) => socket.write(`${line}\r\n`);
    say('220 midan.local ESMTP local sink');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === '.') {
            data = false;
            writeFileSync(join(MAIL, `${Date.now()}-${randomUUID().slice(0, 8)}.eml`), message);
            message = '';
            say('250 OK');
          } else message += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') say('250 midan.local');
        else if (verb === 'DATA') { data = true; say('354 End with .'); }
        else if (verb === 'QUIT') { say('221 Bye'); socket.end(); }
        else say('250 OK');
      }
    });
    socket.on('error', () => undefined);
  }).listen(SMTP_PORT, '127.0.0.1');
}

/** Decodes quoted-printable mail bodies enough to read links. */
function readMail(file) {
  const raw = readFileSync(join(MAIL, file), 'utf8');
  const body = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const to = /^To: (.*)$/m.exec(raw)?.[1]?.trim();
  const subject = /^Subject: (.*)$/m.exec(raw)?.[1]?.trim();
  const links = [...body.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0].replaceAll('&amp;', '&'));
  return { file, to, subject, links };
}

// ---- Storage ----
const pool = new Pool({ connectionString: `postgres://supabase_storage_admin:local-storage@127.0.0.1:${PG_PORT}/midan`, max: 8 });

/** Runs work as the caller's role with their claims, exactly as Supabase Storage does before touching storage.objects. */
async function asCaller(claims, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [
      claims.role === 'authenticated' ? 'authenticated' : 'anon',
      JSON.stringify(claims),
    ]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function callerClaims(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!token || token === LOCAL.publishableKey) return { role: 'anon' };
  return verifyJwt(token);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};
const fail = (res, status, message) => json(res, status === 403 ? 400 : status, { statusCode: String(status), error: message, message });

async function handleStorage(req, res, path) {
  const url = new URL(req.url, LOCAL.url);
  const claims = callerClaims(req);
  if (!claims) return fail(res, 400, 'invalid signature');

  // Signed download: the token is the only authority, as on Supabase.
  let match = /^object\/sign\/([^/]+)\/(.+)$/.exec(path);
  if (match && req.method === 'GET') {
    const grant = verifyJwt(url.searchParams.get('token'));
    if (!grant || grant.url !== `${match[1]}/${decodeURIComponent(match[2])}`) return fail(res, 400, 'invalid signature');
    return sendBlob(res, await blob(match[1], decodeURIComponent(match[2])));
  }
  if (match && req.method === 'POST') {
    const name = decodeURIComponent(match[2]);
    const visible = await asCaller(claims, (c) => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [match[1], name]));
    if (!visible.rowCount) return fail(res, 404, 'Object not found');
    const { expiresIn = 60 } = JSON.parse((await readBody(req)).toString() || '{}');
    const token = signJwt({ url: `${match[1]}/${name}`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + Number(expiresIn) });
    return json(res, 200, { signedURL: `/object/sign/${match[1]}/${encodeURI(name)}?token=${token}` });
  }

  match = /^object\/public\/([^/]+)\/(.+)$/.exec(path);
  if (match && req.method === 'GET') {
    const bucket = await pool.query('select public from storage.buckets where id = $1', [match[1]]);
    if (!bucket.rows[0]?.public) return fail(res, 400, 'Bucket not found');
    return sendBlob(res, await blob(match[1], decodeURIComponent(match[2])));
  }

  if (path === 'object/copy' && req.method === 'POST') {
    const { bucketId, sourceKey, destinationKey } = JSON.parse((await readBody(req)).toString());
    try {
      const copied = await asCaller(claims, async (c) => {
        const source = await c.query('select id, metadata from storage.objects where bucket_id = $1 and name = $2', [bucketId, sourceKey]);
        if (!source.rowCount) return null;
        const inserted = await c.query(
          'insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $3::text, $4) returning id',
          [bucketId, destinationKey, claims.sub ?? null, source.rows[0].metadata],
        );
        return { from: source.rows[0].id, to: inserted.rows[0].id };
      });
      if (!copied) return fail(res, 404, 'Object not found');
      await pool.query('insert into storage.local_blobs (object_id, content) select $2, content from storage.local_blobs where object_id = $1', [copied.from, copied.to]);
      return json(res, 200, { Key: `${bucketId}/${destinationKey}` });
    } catch (error) {
      return fail(res, 403, error.message);
    }
  }

  // A folder's files and subfolders, among the objects the caller's policies let them see, as Supabase lists them.
  match = /^object\/list\/([^/]+)$/.exec(path);
  if (match && req.method === 'POST') {
    const { prefix = '' } = JSON.parse((await readBody(req)).toString() || '{}');
    const folder = prefix.replace(/\/+$/, '');
    const start = folder ? `${folder}/` : '';
    const rows = await asCaller(claims, (c) => c.query(
      'select id, name, created_at, metadata from storage.objects where bucket_id = $1 and left(name, length($2)) = $2 order by name',
      [match[1], start],
    ));
    const entries = new Map();
    for (const row of rows.rows) {
      const [first, ...deeper] = row.name.slice(start.length).split('/');
      if (!entries.has(first)) entries.set(first, deeper.length ? { name: first, id: null } : { name: first, id: row.id, created_at: row.created_at, metadata: row.metadata });
    }
    return json(res, 200, [...entries.values()]);
  }

  match = /^object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(path);
  if (!match) return fail(res, 404, 'Not found');
  const [, bucketId, rawName] = match;
  const name = decodeURIComponent(rawName);

  if (req.method === 'GET') {
    const found = await asCaller(claims, (c) => c.query('select id from storage.objects where bucket_id = $1 and name = $2', [bucketId, name]));
    if (!found.rowCount) return fail(res, 400, 'Object not found');
    return sendBlob(res, await blob(bucketId, name));
  }

  if (req.method === 'DELETE') {
    const removed = await asCaller(claims, (c) => c.query('delete from storage.objects where bucket_id = $1 and name = $2 returning id', [bucketId, name]));
    if (!removed.rowCount) return fail(res, 400, 'Object not found');
    return json(res, 200, { message: 'Successfully deleted' });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const bucket = (await pool.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucketId])).rows[0];
    if (!bucket) return fail(res, 400, 'Bucket not found');
    const body = await readBody(req);
    const mime = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
    if (bucket.file_size_limit && body.length > Number(bucket.file_size_limit)) return fail(res, 413, 'The object exceeded the maximum allowed size');
    if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(mime)) return fail(res, 415, `mime type ${mime} is not supported`);
    const upsert = req.method === 'PUT' || req.headers['x-upsert'] === 'true';
    try {
      const id = await asCaller(claims, async (c) => {
        const metadata = { mimetype: mime, size: body.length };
        const sql = upsert
          ? `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $3::text, $4)
             on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now() returning id`
          : 'insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $3::text, $4) returning id';
        return (await c.query(sql, [bucketId, name, claims.sub ?? null, metadata])).rows[0].id;
      });
      await pool.query(
        'insert into storage.local_blobs (object_id, content) values ($1, $2) on conflict (object_id) do update set content = excluded.content',
        [id, body],
      );
      return json(res, 200, { Key: `${bucketId}/${name}`, Id: id });
    } catch (error) {
      if (error.code === '23505') return fail(res, 409, 'The resource already exists');
      return fail(res, 403, error.message);
    }
  }
  return fail(res, 405, 'Method not allowed');
}

async function blob(bucketId, name) {
  return (await pool.query(
    `select b.content, o.metadata ->> 'mimetype' as mime from storage.objects o join storage.local_blobs b on b.object_id = o.id
     where o.bucket_id = $1 and o.name = $2`, [bucketId, name],
  )).rows[0];
}
function sendBlob(res, row) {
  if (!row) return fail(res, 400, 'Object not found');
  res.writeHead(200, { 'content-type': row.mime ?? 'application/octet-stream', 'content-length': row.content.length });
  res.end(row.content);
}

// ---- Gateway ----
function proxy(req, res, port, path) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  // As Supabase's gateway does, a request carrying only the publishable key reaches PostgREST as anon.
  if (port === REST_PORT) {
    const bearer = (headers.authorization ?? '').replace(/^Bearer /, '');
    if (!bearer || bearer === LOCAL.publishableKey) headers.authorization = `Bearer ${ANON_JWT}`;
  }
  const upstream = httpRequest({ host: '127.0.0.1', port, path, method: req.method, headers }, (reply) => {
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on('error', () => json(res, 502, { message: 'Local service unavailable' }));
  req.pipe(upstream);
}

function startGateway() {
  const handler = async (req, res) => {
    const url = new URL(req.url, LOCAL.url);
    try {
      if (url.pathname === '/__mail') {
        const files = readdirSync(MAIL).filter((f) => f.endsWith('.eml')).sort().reverse();
        return json(res, 200, files.map(readMail).filter((m) => !url.searchParams.get('to') || m.to?.includes(url.searchParams.get('to'))));
      }
      if (url.pathname.startsWith('/auth/v1/')) return proxy(req, res, AUTH_PORT, req.url.slice('/auth/v1'.length));
      if (url.pathname.startsWith('/rest/v1/')) return proxy(req, res, REST_PORT, req.url.slice('/rest/v1'.length));
      if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url.pathname.slice('/storage/v1/'.length));
      return json(res, 404, { message: 'Not found' });
    } catch (error) {
      console.error('gateway error', error.message);
      if (!res.headersSent) json(res, 500, { message: 'Local gateway error' });
    }
  };
  createServer(handler).listen(54321, '127.0.0.1', () => console.log(`Local Supabase on ${LOCAL.url} (auth, rest, storage; mail at ${LOCAL.url}/__mail)`));
  // "localhost" can resolve to ::1 first. With nothing listening there, this port being in the ephemeral range lets a client's
  // socket occasionally connect to itself, read its own request back as the reply, and be reused for every later request.
  createServer(handler).listen(54321, '::1').on('error', () => undefined);
}

function startRest() {
  return spawn(join(BIN, 'postgrest'), [], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:local-authenticator@127.0.0.1:${PG_PORT}/midan`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: LOCAL.jwtSecret,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(REST_PORT),
      PGRST_LOG_LEVEL: 'crit',
    },
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv[2] === 'migrate') {
    await migrateAuth();
    process.exit(0);
  }
  startMailSink();
  const children = [runAuth(['serve']), startRest()];
  startGateway();
  const stop = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
