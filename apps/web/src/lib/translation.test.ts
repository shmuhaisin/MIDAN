import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoFillable, canApply, originOf, other, shouldTranslate } from './translation.ts';

test('translates into an empty or machine-filled field, never into the employer\'s own words', () => {
  assert.equal(shouldTranslate({ sourceText: 'محلل بيانات', targetOrigin: 'empty', targetFocused: false }), true);
  assert.equal(shouldTranslate({ sourceText: 'محلل بيانات', targetOrigin: 'auto', targetFocused: false }), true);
  assert.equal(shouldTranslate({ sourceText: 'محلل بيانات', targetOrigin: 'manual', targetFocused: false }), false);
  assert.equal(shouldTranslate({ sourceText: 'محلل بيانات', targetOrigin: 'saved', targetFocused: false }), false);
});

test('does not write into a field while the employer is in it, nor translate a single character', () => {
  assert.equal(shouldTranslate({ sourceText: 'Analyst', targetOrigin: 'empty', targetFocused: true }), false);
  assert.equal(shouldTranslate({ sourceText: ' a ', targetOrigin: 'empty', targetFocused: false }), false);
});

test('drops a late translation when the source changed or the target was edited, unless asked for explicitly', () => {
  assert.equal(canApply({ requestedText: 'Analyst', currentSourceText: 'Analyst', targetOrigin: 'auto', explicit: false }), true);
  assert.equal(canApply({ requestedText: 'Analys', currentSourceText: 'Analyst', targetOrigin: 'auto', explicit: false }), false);
  assert.equal(canApply({ requestedText: 'Analyst', currentSourceText: 'Analyst', targetOrigin: 'manual', explicit: false }), false);
  assert.equal(canApply({ requestedText: 'Analyst', currentSourceText: 'Analyst', targetOrigin: 'manual', explicit: true }), true);
});

test('saved text counts as the employer\'s own; the pair is Arabic and English', () => {
  assert.equal(originOf('نص محفوظ'), 'saved');
  assert.equal(originOf('  '), 'empty');
  assert.equal(originOf(null), 'empty');
  assert.equal(autoFillable('saved'), false);
  assert.equal(other('ar'), 'en');
});
