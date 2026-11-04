import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** Loads git-ignored env files from the repo root. Variables already set take precedence. */
export function loadEnv(...files: string[]) {
  for (const file of files) {
    const path = resolve(__dirname, '../../../..', file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      process.env[key] ??= value;
    }
  }
}
