import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The official palette set by the owner's full-redesign brief (docs/DECISIONS.md, 2026-11-08, redesign entry).
// It replaces the earlier 2026-11-08 palette (#0F5B46, #1F7A5C, #DCEEE5, #F7F4EE, #1F2A26).
const APPROVED = { deep: '#0b3d2e', green: '#1f7a4d', mint: '#a7e3c2', ivory: '#f7f4e9', gold: '#d4af37' };
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').toLowerCase();

test('the brand tokens are the official palette', () => {
  for (const [name, hex] of Object.entries(APPROVED)) assert.match(css, new RegExp(`--brand-${name}: ${hex};`), name);
});

test('no colour from the replaced palette remains', () => {
  for (const hex of ['#0f5b46', '#1f7a5c', '#dceee5', '#f7f4ee', '#1f2a26']) assert.ok(!css.includes(hex), hex);
});

test('the light theme is built on the brand tokens', () => {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const line of ['--background: var(--brand-ivory)', '--primary: var(--brand-green)', '--secondary: var(--brand-deep)', '--gold: var(--brand-gold)', '--button: var(--brand-deep)']) {
    assert.ok(root.includes(line), line);
  }
});

test('the dark theme keeps the brand: mint for action, gold for accents', () => {
  const dark = css.slice(css.indexOf("[data-theme='dark'] {"), css.indexOf('}', css.indexOf("[data-theme='dark'] {")));
  for (const line of ['--primary: var(--brand-mint)', '--gold: var(--brand-gold)', '--deep: var(--brand-deep)']) assert.ok(dark.includes(line), line);
});
