import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { datePart, formatDate, formatWhen, intlLocale, number } from './format.ts';

// MIDAN shows English digits 0–9 everywhere, in Arabic too (owner's requirement, 2026-11-10).
const ARABIC_INDIC = /[٠-٩۰-۹]/;
const when = new Date('2026-11-10T11:05:00Z');

test('numbers and percentages use English digits in Arabic and English', () => {
  for (const locale of ['ar', 'en']) {
    assert.ok(!ARABIC_INDIC.test(number(locale, 1234.5)), number(locale, 1234.5));
    assert.ok(!ARABIC_INDIC.test(number(locale, 0.42, { style: 'percent' })));
    assert.match(number(locale, 2026), /2,?026/);
  }
});

test('dates and times use English digits and the Gregorian calendar in Arabic', () => {
  for (const out of [formatWhen('ar', when, 'Asia/Riyadh'), formatDate('ar', when, 'Asia/Riyadh'), datePart('ar', when, 'Asia/Riyadh', { hour: 'numeric', minute: '2-digit' })]) {
    assert.ok(!ARABIC_INDIC.test(out), out);
  }
  assert.match(formatDate('ar', when, 'Asia/Riyadh'), /2026/);
  assert.equal(intlLocale('ar'), 'ar-SA-u-nu-latn-ca-gregory');
});

test('no message, in either language, is written with Arabic-Indic digits', () => {
  for (const lang of ['ar', 'en']) {
    const text = readFileSync(new URL(`../messages/${lang}.json`, import.meta.url), 'utf8');
    assert.ok(!ARABIC_INDIC.test(text), `${lang}.json contains Arabic-Indic digits`);
  }
});

test('no screen formats with a locale that defaults to Arabic-Indic digits', () => {
  const offenders = ['ar-SA-u-ca-gregory', "'ar-SA'"];
  const files = readFileSync(new URL('./format.ts', import.meta.url), 'utf8');
  for (const o of offenders) assert.ok(!files.includes(o), o);
});
