import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const load = (l: string) => JSON.parse(readFileSync(new URL(`./${l}.json`, import.meta.url), 'utf8'));

function shape(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${prefix}[${i}]`))];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

test('ar and en have identical message shape', () => {
  assert.deepEqual(shape(load('ar')).sort(), shape(load('en')).sort());
});

test('no empty strings in either language', () => {
  for (const locale of ['ar', 'en']) {
    const text = JSON.stringify(load(locale));
    assert.equal(text.includes('""'), false, locale);
  }
});

test('Arabic strings actually contain Arabic', () => {
  assert.match(load('ar').home.heroLead, /[؀-ۿ]/);
});
