import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The official palette set by the owner on 2026-11-10 (docs/DECISIONS.md): #0F5B46, #1F7A5C, #DCEEE5, #F7F4EE, #1F2A26.
// It replaces the gold palette of 2026-11-08 (#0B3D2E, #1F7A4D, #A7E3C2, #F7F4E9, #D4AF37). No gold.
const APPROVED = { deep: '#0f5b46', green: '#1f7a5c', mint: '#dceee5', ivory: '#f7f4ee', ink: '#1f2a26' };
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').toLowerCase();

test('the brand tokens are the official palette', () => {
  for (const [name, hex] of Object.entries(APPROVED)) assert.match(css, new RegExp(`--brand-${name}: ${hex};`), name);
});

test('no colour from the replaced gold palette remains', () => {
  for (const hex of ['#0b3d2e', '#1f7a4d', '#a7e3c2', '#f7f4e9', '#d4af37', '#f1d77c']) assert.ok(!css.includes(hex), hex);
  const world = readFileSync(new URL('../components/journey/world.ts', import.meta.url), 'utf8').toLowerCase();
  assert.ok(!world.includes('#d4af37'), 'journey scene');
});

test('the light theme is built on the brand tokens', () => {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const line of ['--background: var(--brand-ivory)', '--primary: var(--brand-green)', '--secondary: var(--brand-deep)', '--gold: var(--brand-green)', '--button: var(--brand-deep)']) {
    assert.ok(root.includes(line), line);
  }
});

test('the dark theme keeps the brand: mint for action and accents', () => {
  const dark = css.slice(css.indexOf("[data-theme='dark'] {"), css.indexOf('}', css.indexOf("[data-theme='dark'] {")));
  for (const line of ['--primary: var(--brand-mint)', '--gold: var(--brand-mint)', '--deep: var(--brand-deep)']) assert.ok(dark.includes(line), line);
});
