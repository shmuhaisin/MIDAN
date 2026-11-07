import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canReopenApplications, MANUAL_STATUS_CHANGES, statusOptions } from './application-status.ts';

const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);
const NAME = 'function private.manual_status_change_allowed';

/**
 * Reads the allowed moves out of the latest definition of private.manual_status_change_allowed:
 * "when 'to' then p_from in (...)" or "p_from = '...'".
 */
function fromDatabase() {
  const file = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().filter((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8').includes(NAME)).at(-1)!;
  const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8');
  const start = sql.indexOf(NAME);
  const body = sql.slice(start, sql.indexOf('$$;', start));
  const moves = new Set<string>();
  for (const [, to, from] of body.matchAll(/when '(\w+)' then p_from (?:in \(([^)]*)\)|= ('\w+'))/g).map((m) => [m[0], m[1], m[2] ?? m[3]])) {
    for (const [, status] of from.matchAll(/'(\w+)'/g)) moves.add(`${status}->${to}`);
  }
  return moves;
}

test('the screen offers exactly the moves the database allows', () => {
  const offered = new Set(Object.entries(MANUAL_STATUS_CHANGES).flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`)));
  assert.deepEqual([...offered].sort(), [...fromDatabase()].sort());
});

test('hiring needs a shortlist or a reviewed evaluation, and hired and withdrawn applications offer nothing', () => {
  assert.deepEqual(Object.keys(MANUAL_STATUS_CHANGES).filter((from) => MANUAL_STATUS_CHANGES[from].includes('hired')).sort(), ['evaluated', 'shortlisted']);
  assert.ok(!Object.values(MANUAL_STATUS_CHANGES).some((to) => to.includes('evaluated') || to.includes('submitted')), 'never set by hand');
  assert.deepEqual(statusOptions('hired'), ['hired']);
  assert.deepEqual(statusOptions('withdrawn'), ['withdrawn']);
  assert.deepEqual(statusOptions('submitted'), ['submitted', 'under_review', 'shortlisted', 'rejected']);
});

test('only a hiring manager is offered reopening a rejected application', () => {
  assert.deepEqual(statusOptions('rejected'), ['rejected']);
  assert.deepEqual(statusOptions('rejected', true), ['rejected', 'under_review', 'shortlisted']);
  assert.ok(canReopenApplications('owner') && canReopenApplications('admin'));
  assert.ok(!canReopenApplications('recruiter') && !canReopenApplications('reviewer') && !canReopenApplications());
});
