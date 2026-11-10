import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoToZonedLocal, zonedLocalToIso } from './zoned-time.ts';

test('a wall-clock time is read in Asia/Riyadh whatever the machine zone is', () => {
  assert.equal(zonedLocalToIso('2026-11-12T10:30'), '2026-11-12T07:30:00.000Z');
  assert.equal(zonedLocalToIso('2026-11-12T00:15'), '2026-11-11T21:15:00.000Z');
});

test('the conversion goes back to the same wall-clock value', () => {
  assert.equal(isoToZonedLocal('2026-11-12T07:30:00.000Z'), '2026-11-12T10:30');
  assert.equal(isoToZonedLocal(zonedLocalToIso('2026-12-31T23:45')!), '2026-12-31T23:45');
});

test('a zone with daylight saving time is handled on both sides of the change', () => {
  assert.equal(zonedLocalToIso('2026-07-01T12:00', 'Europe/London'), '2026-07-01T11:00:00.000Z');
  assert.equal(zonedLocalToIso('2026-12-01T12:00', 'Europe/London'), '2026-12-01T12:00:00.000Z');
});

test('anything that is not a date and time is refused', () => {
  assert.equal(zonedLocalToIso(''), null);
  assert.equal(zonedLocalToIso('tomorrow'), null);
});
