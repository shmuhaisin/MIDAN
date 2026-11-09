import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdCentre, INPUT, LAST, sceneVisibility, toPosition } from './journey-model.ts';

test('position is a pure, monotonic function of progress, from arrival to destination', () => {
  assert.equal(toPosition(0), 0);
  assert.equal(toPosition(1), LAST);
  let last = -1;
  for (let i = 0; i <= 2000; i++) {
    const s = toPosition(i / 2000);
    assert.ok(s >= last, `position went back at p=${i / 2000}`);
    // No jump between neighbouring frames: a scene can't be skipped.
    if (last >= 0) assert.ok(s - last < 0.02, `jump at p=${i / 2000}`);
    last = s;
  }
});

test('out-of-range progress is clamped, never NaN', () => {
  assert.equal(toPosition(-0.5), 0);
  assert.equal(toPosition(1.5), LAST);
  assert.equal(toPosition(Number.NaN), 0);
});

test('every scene holds: the car stops at each destination', () => {
  for (let k = 0; k <= LAST; k++) {
    const [from, to] = k === 0 ? [0, INPUT[1]] : [INPUT[k * 2], INPUT[k * 2 + 1]];
    for (const p of [from, (from + to) / 2, to]) assert.equal(toPosition(p), k, `scene ${k} at p=${p}`);
    assert.equal(toPosition(holdCentre(k)), k);
  }
});

test('exactly one scene is fully shown during each hold, and each is shown somewhere', () => {
  for (let k = 0; k <= LAST; k++) {
    const shown = [0, 1, 2, 3, 4].filter((j) => sceneVisibility(j, k) === 1);
    assert.deepEqual(shown, [k]);
  }
  // Halfway between two scenes the copy is out of the way.
  for (let k = 0; k < LAST; k++) assert.equal(sceneVisibility(k, k + 0.5), 0);
});
