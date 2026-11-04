import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { HUMAIDAN_FILES, PROFESSIONAL_FIELDS, resolveHumaidan, safeVariant } from './humaidan.ts';

test('each field shows its approved variant', () => {
  const expected = {
    general: 'original', finance: 'finance', legal: 'legal', engineering: 'engineering', technology: 'tech',
    events: 'events', healthcare: 'healthcare', media: 'original', marketing: 'original',
  };
  for (const field of PROFESSIONAL_FIELDS) assert.equal(resolveHumaidan(field), expected[field], field);
});

test('assessment field wins over organization industry, which wins over Original', () => {
  assert.equal(resolveHumaidan('technology', 'finance'), 'tech');
  assert.equal(resolveHumaidan(null, 'finance'), 'finance');
  assert.equal(resolveHumaidan(null, null), 'original');
  assert.equal(resolveHumaidan('marketing', 'finance'), 'original');
});

test('anything unrecognized falls back to Original', () => {
  assert.equal(resolveHumaidan('nonsense'), 'original');
  assert.equal(resolveHumaidan('constructor'), 'original');
  assert.equal(safeVariant('nonsense'), 'original');
  assert.equal(safeVariant('__proto__'), 'original');
  assert.equal(safeVariant(undefined), 'original');
});

test('every approved file exists under its original name', () => {
  const files = readdirSync(new URL('../../public/assets/humaidan/', import.meta.url));
  for (const file of Object.values(HUMAIDAN_FILES)) assert.ok(files.includes(file), file);
});
