import { pick } from './format';

export const REQUIREMENT_TYPES = ['responsibility', 'daily_task', 'qualification', 'education', 'experience', 'competency', 'certification', 'language', 'other'] as const;

/** Either language may be missing, so show whichever exists. */
export function requirementText(locale: string, r: { description_ar: string | null; description_en: string | null }) {
  return (pick(locale, r.description_ar ?? '', r.description_en ?? '') || r.description_en || r.description_ar) ?? '';
}
