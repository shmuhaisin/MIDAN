// Imports the official reference data, repeatably, with lineage. Safe to run again: unchanged rows stay unchanged and
// nothing is duplicated. Every record, issue and statistic is kept in import_runs and import_records.
//
//   node scripts/import-data.mjs --sectors "<folder or .zip of sector workbooks>" --employers <ALMIDAN_Employer_Database.xlsx>
//   node scripts/import-data.mjs --listings <listings.json> --source-type employer_provided|employer_career_site|other_authorized
//
// Job listings come only from authorized sources, through --listings. The employer workbook is read for identity only.
//
// Connects as midan_importer, which can only call the import functions. Locally the password is set by
// scripts/local-db.sh; elsewhere set IMPORT_DATABASE_URL. The workbooks stay out of this public repository.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith('--') ? [...acc, [arg.slice(2), all[i + 1]]] : acc), []));
const root = fileURLToPath(new URL('..', import.meta.url));
const url = process.env.IMPORT_DATABASE_URL ?? `postgresql://midan_importer:midan-importer-local@127.0.0.1:${process.env.LOCAL_PG_PORT ?? 54322}/midan`;
const startedBy = process.env.IMPORT_STARTED_BY ?? `cli:${process.env.USER ?? 'unknown'}`;

function python(script, ...scriptArgs) {
  // An isolated interpreter with only openpyxl, so the workbooks can't load code from anywhere.
  return execFileSync('uv', ['run', '--quiet', '--no-project', '--with', 'openpyxl==3.1.5', 'python', '-X', 'utf8', '-I', join(root, 'scripts', script), ...scriptArgs], {
    maxBuffer: 512 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function unpack(path) {
  if (statSync(path).isDirectory()) return { folder: path, cleanup: () => undefined };
  const folder = mkdtempSync(join(tmpdir(), 'midan-sectors-'));
  execFileSync('uv', ['run', '--quiet', '--no-project', 'python', '-I', '-c',
    // The archive stores UTF-8 names without the UTF-8 flag, so the encoding is stated. macOS resource forks are skipped.
    'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1], metadata_encoding="utf-8")\nz.extractall(sys.argv[2], [n for n in z.namelist() if "__MACOSX" not in n])', path, folder]);
  return { folder, cleanup: () => rmSync(folder, { recursive: true, force: true }) };
}

const db = new Client({ connectionString: url });
await db.connect();
const call = async (sql, params) => (await db.query(sql, params)).rows[0];

async function run(kind, sources, work) {
  const { id } = await call('select private.begin_import($1, $2, $3) as id', [kind, JSON.stringify(sources), startedBy]);
  try {
    const report = await work(id);
    const done = await call('select * from private.finish_import($1, $2)', [id, JSON.stringify(report)]);
    console.log(`${kind}: run ${id} completed`, JSON.stringify(done.stats));
    return done;
  } catch (error) {
    await call('select * from private.finish_import($1, $2, $3)', [id, '{}', String(error.message).slice(0, 500)]);
    throw error;
  }
}

try {
  if (args.sectors) {
    const { folder, cleanup } = unpack(args.sectors);
    try {
      const { skills, reports } = JSON.parse(python('extract-reference-data.py', folder));
      await run('sector_skills', reports.map((r) => ({ file: r.file, sha256: r.sha256, sheets: r.sheets })), async (id) => {
        for (let i = 0; i < skills.length; i += 500) {
          await call('select private.import_skill_batch($1, $2) as counts', [id, JSON.stringify(skills.slice(i, i + 500))]);
        }
        await call('select private.record_import_issues($1, $2)', [id, JSON.stringify(reports.flatMap((r) => r.issues))]);
        return {
          workbooks: reports.map(({ issues, sheets, ...r }) => ({ ...r, issue_count: issues.length })),
          totals: { skills: skills.length, technical: skills.filter((s) => s.skill_kind === 'technical').length, general: skills.filter((s) => s.skill_kind === 'general').length,
            contexts: skills.reduce((n, s) => n + s.contexts.length, 0) },
        };
      });
    } finally {
      cleanup();
    }
  }

  if (args.employers) {
    const { employers, report } = JSON.parse(python('extract-employers.py', args.employers, basename(args.employers)));
    await run('employer_registry', [{ file: report.file, sha256: report.sha256, sheets: report.sheets }], async (id) => {
      await call('select private.import_employer_batch($1, $2)', [id, JSON.stringify(employers)]);
      await call('select private.record_import_issues($1, $2)', [id, JSON.stringify(report.issues)]);
      return { readme: report.readme, employers: employers.length };
    });
  }

  if (args.listings) {
    const type = args['source-type'];
    if (!['employer_career_site', 'employer_provided', 'other_authorized'].includes(type)) throw new Error('Pass --source-type');
    const listings = JSON.parse(readFileSync(args.listings, 'utf8'));
    if (!Array.isArray(listings)) throw new Error('Listings file must be a JSON array');
    await run('job_listings', [{ file: basename(args.listings), rows: listings.length, source_type: type }], async (id) => {
      const rows = listings.map((l, i) => ({ ...l, source_file: basename(args.listings), source_row: i + 1 }));
      for (let i = 0; i < rows.length; i += 200) await call('select private.import_listing_batch($1, $2, $3)', [id, type, JSON.stringify(rows.slice(i, i + 200))]);
      return { source_type: type, rows: rows.length };
    });
  }
} finally {
  await db.end();
}
