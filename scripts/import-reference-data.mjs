// Loads reference data into the database. See "Reference data" in docs/database/README.md for the grant this needs.
//   node scripts/import-reference-data.mjs reference-skills.json employers.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const env = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const [skillsFile, employersFile] = process.argv.slice(2);
const { skills } = JSON.parse(readFileSync(skillsFile, 'utf8'));
const employers = employersFile ? JSON.parse(readFileSync(employersFile, 'utf8')) : [];
const load = (data) => prisma.$queryRaw`select private.import_reference_data(${JSON.stringify(data)}::jsonb) as result`;

try {
  if (employers.length) console.log('employers', (await load({ employers })).length, employers.length);
  let done = 0;
  for (let i = 0; i < skills.length; i += 400) {
    await load({ skills: skills.slice(i, i + 400) });
    done += Math.min(400, skills.length - i);
    console.log(`skills ${done}/${skills.length}`);
  }
} finally {
  await prisma.$disconnect();
}
