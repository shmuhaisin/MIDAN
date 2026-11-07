import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The palette the owner approved on 2026-11-08 (docs/DECISIONS.md). It replaces the overnight brief's values.
const APPROVED = { forest: '#0f5b46', green: '#1f7a5c', mint: '#dceee5', ivory: '#f7f4ee', ink: '#1f2a26' };
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').toLowerCase();

test('the brand tokens are the approved palette', () => {
  for (const [name, hex] of Object.entries(APPROVED)) assert.match(css, new RegExp(`--brand-${name}: ${hex};`), name);
});

test("no colour from the replaced brief remains: no gold, and the deep green isn't #0b3d2e", () => {
  for (const hex of ['#d4af37', '#0b3d2e', '#1f7a4d', '#a7e3c2', '#f7f4e9']) assert.ok(!css.includes(hex), hex);
  assert.ok(!css.includes('--brand-gold'));
});

test('the light theme is built on the approved tokens', () => {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const line of ['--background: var(--brand-ivory)', '--foreground: var(--brand-ink)', '--primary: var(--brand-green)', '--secondary: var(--brand-forest)', '--accent: var(--brand-mint)']) {
    assert.ok(root.includes(line), line);
  }
});
