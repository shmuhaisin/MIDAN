/**
 * The journey's one scroll model, kept apart from React and three.js so it can be tested.
 *
 * Progress `p` (0–1) is measured from the section against the pinned stage's real bounds. The journey position `s`
 * (0 = arrival … 4 = destination) is a pure function of it that holds at each scene, so the vehicle stops at every
 * destination. The 3D world, the copy and the progress rail all read `s`; nothing animates towards it, so nothing can
 * trail the scroll.
 */
export const INPUT = [0, 0.07, 0.2325, 0.3025, 0.465, 0.535, 0.6975, 0.7675, 0.93, 1];
export const OUTPUT = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
export const LAST = 4;

export function toPosition(p: number) {
  const q = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
  for (let i = 1; i < INPUT.length; i++) {
    if (q <= INPUT[i]) {
      const f = (q - INPUT[i - 1]) / (INPUT[i] - INPUT[i - 1]);
      return OUTPUT[i - 1] + (OUTPUT[i] - OUTPUT[i - 1]) * f;
    }
  }
  return LAST;
}

/** The progress at the middle of scene k's hold: where the rail scrolls to. */
export function holdCentre(k: number) {
  return k === 0 ? 0 : (INPUT[k * 2] + INPUT[k * 2 + 1]) / 2;
}

/** A scene's copy is fully shown during its hold and crossfades while the car travels. */
export function sceneVisibility(k: number, s: number) {
  const d = s - k;
  if (k === 0 && d <= 0) return 1;
  if (k === LAST && d >= 0) return 1;
  const a = Math.abs(d);
  return a <= 0.12 ? 1 : a >= 0.42 ? 0 : 1 - (a - 0.12) / 0.3;
}
