// Automatic Arabic <-> English translation of paired job fields (employer brief, section 7): the rules that decide when a
// field may be filled by translation. Pure, so they're unit-tested (translation.test.ts); components/bilingual.tsx applies them.

export type Lang = 'ar' | 'en';
/**
 * Where a field's current text came from:
 * - empty: nothing in it
 * - saved: what was saved before (opening a draft or a job); treated like the employer's own words
 * - manual: typed by the employer in this session
 * - auto: filled by translation and not edited since
 */
export type Origin = 'empty' | 'saved' | 'manual' | 'auto';

export const DEBOUNCE_MS = 900;
export const other = (lang: Lang): Lang => (lang === 'ar' ? 'en' : 'ar');

/** A field the employer wrote (or saved) is never overwritten automatically; an empty or machine-filled one may be. */
export const autoFillable = (origin: Origin) => origin === 'empty' || origin === 'auto';

/** Whether typing in `source` should translate into the other field now. */
export function shouldTranslate(input: { sourceText: string; targetOrigin: Origin; targetFocused: boolean }) {
  return input.sourceText.trim().length >= 2 && autoFillable(input.targetOrigin) && !input.targetFocused;
}

/** Whether a translation that just arrived may still be applied: the source hasn't changed and the target is still free. */
export function canApply(input: { requestedText: string; currentSourceText: string; targetOrigin: Origin; explicit: boolean }) {
  if (input.requestedText !== input.currentSourceText) return false;
  return input.explicit || autoFillable(input.targetOrigin);
}

export const originOf = (value: string | null | undefined): Origin => (value && value.trim() ? 'saved' : 'empty');
