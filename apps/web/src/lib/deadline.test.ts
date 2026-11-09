import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadlineState, riyadhToday } from './deadline.ts';

const at = (iso: string) => Date.parse(iso);

test('a deadline is a Riyadh date and counts the whole day', () => {
  // 22:30 UTC on 9 Nov is already 10 Nov in Riyadh.
  assert.equal(riyadhToday(at('2026-11-09T22:30:00Z')), '2026-11-10');
  assert.equal(deadlineState('2026-11-10', at('2026-11-10T20:59:00Z')), 'closing_soon');
  assert.equal(deadlineState('2026-11-09', at('2026-11-09T22:30:00Z')), 'closed');
});

test('open, closing soon within seven days, closed, or no deadline', () => {
  const now = at('2026-11-10T08:00:00Z');
  assert.equal(deadlineState(null, now), null);
  assert.equal(deadlineState('2026-11-17', now), 'closing_soon');
  assert.equal(deadlineState('2026-11-18', now), 'open');
  assert.equal(deadlineState('2026-11-09T00:00:00.000Z', now), 'closed');
});
