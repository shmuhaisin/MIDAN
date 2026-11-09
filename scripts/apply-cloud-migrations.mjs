// Applies the repository's pending migrations to the Supabase Cloud project, exactly as the files read, and records each
// in supabase_migrations.schema_migrations with the file's own version, as the earlier ones were.
//
//   node scripts/apply-cloud-migrations.mjs            show what would be applied (no change)
//   node scripts/apply-cloud-migrations.mjs --apply    apply them
//
// MIGRATION_DATABASE_URL, in the project's .env with every other setting (git-ignored), is the project's postgres
// connection (Dashboard > Connect > Session pooler, port 5432). Only this script reads it: the web app never sees it, and
// scripts/local-up-windows.ps1 doesn't pass it to the services. It isn't the API's midan_api login, which can't change the
// schema by design. A value set in the shell for one command takes precedence (used by --local-test).
//
// Safety: refuses unless the project's applied history matches the repository's files one for one (same versions, same
// text); each migration runs in its own transaction with its history row, so a failure leaves nothing half-applied and
// stops before the next one; afterwards every applied file's MD5 is checked against the stored text. Rehearse first:
// scripts/rehearse-migrations.sh.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { Client } = createRequire(join(ROOT, 'apps/api/package.json'))('pg');
// From the project's .env (the shell's value first, for one-off local tests). Never printed.
const envFile = join(ROOT, '.env');
const url = process.env.MIGRATION_DATABASE_URL
  || (existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).MIGRATION_DATABASE_URL : undefined);
const apply = process.argv.includes('--apply');
const md5 = (text) => createHash('md5').update(text).digest('hex');
// The stored text uses LF line endings, as the earlier migrations were applied.
const read = (file) => readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8').replace(/\r\n/g, '\n');

if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set in .env (see the top of this file and .env.example).');
  process.exit(2);
}
// --local-test: only the throwaway rehearsal cluster (scripts/rehearse-migrations.sh --baseline, port 54417).
const localTest = process.argv.includes('--local-test');
if (localTest ? !/@127\.0\.0\.1:54417\//.test(url) : !/supabase\.(co|com)/.test(url)) {
  console.error(localTest ? '--local-test only runs against 127.0.0.1:54417.' : 'MIGRATION_DATABASE_URL is not a Supabase connection.');
  process.exit(2);
}

const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const db = new Client({ connectionString: url.replace(/\?.*$/, ''), ...(localTest ? {} : { ssl: { rejectUnauthorized: false } }) });
await db.connect();
try {
  const applied = (await db.query('select version, name, statements from supabase_migrations.schema_migrations order by version')).rows;
  // The history must be the repository's first N files, unchanged.
  for (const [i, row] of applied.entries()) {
    const file = files[i];
    if (!file || !file.startsWith(`${row.version}_`)) throw new Error(`History row ${row.version} doesn't match the repository file at position ${i + 1} (${file ?? 'none'})`);
    if (md5(row.statements?.[0] ?? '') !== md5(read(file))) throw new Error(`Applied migration ${row.version} differs from ${file}`);
  }
  const pending = files.slice(applied.length);
  console.log(`Applied: ${applied.length} (history matches the repository). Pending: ${pending.length}.`);
  if (!apply) {
    for (const f of pending) console.log(`  would apply ${f}`);
    console.log('Nothing changed. Run again with --apply.');
  } else {
    for (const f of pending) {
      const [version] = f.split('_', 1);
      const name = f.slice(version.length + 1, -4);
      const sql = read(f);
      await db.query('begin');
      try {
        await db.query(sql);
        await db.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [version, name, [sql]]);
        await db.query('commit');
        console.log(`  applied ${f}`);
      } catch (error) {
        await db.query('rollback');
        throw new Error(`${f} failed and was rolled back; later migrations were not applied: ${error.message}`);
      }
    }
    const after = (await db.query('select version, statements from supabase_migrations.schema_migrations order by version')).rows;
    const mismatched = after.filter((row, i) => md5(row.statements?.[0] ?? '') !== md5(read(files[i])));
    if (after.length !== files.length || mismatched.length) throw new Error(`Check after applying failed: ${after.length}/${files.length} recorded, ${mismatched.length} differ`);
    console.log(`Done: ${after.length}/${files.length} migrations recorded, each identical to its file.`);
  }
} finally {
  await db.end();
}
