import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MANUAL_STATUS_CHANGES, statusOptions } from './application-status.ts';

const MIGRATION = '../../../../supabase/migrations/20261107090100_application_status_transitions.sql';

/** Reads the allowed moves out of private.manual_status_change_allowed: "when 'to' then p_from in (...)" or "p_from = '...'". */
function fromDatabase() {
  const sql = readFileSync(new URL(MIGRATION, import.meta.url), 'utf8');
  const body = sql.slice(sql.indexOf('create function private.manual_status_change_allowed'), sql.indexOf('create function public.set_application_status'));
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
