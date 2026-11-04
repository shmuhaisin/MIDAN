/**
 * Which Humaidan appears where. One character, seven approved original files.
 * A variant is never chosen at random or typed in: it follows from a saved professional field.
 */
export const HUMAIDAN_FILES = {
  original: '01_Humaidan_Original.png',
  finance: '02_Humaidan_Finance.png',
  legal: '03_Humaidan_Legal_Brown_Bisht.png',
  engineering: '04_Humaidan_Engineering.png',
  tech: '05_Humaidan_Tech_Cybersecurity.png',
  events: '06_Humaidan_Entertainment_Events.png',
  healthcare: '07_Humaidan_Healthcare.png',
} as const;

export type HumaidanVariant = keyof typeof HUMAIDAN_FILES;

export const PROFESSIONAL_FIELDS = ['general', 'finance', 'legal', 'engineering', 'technology', 'events', 'healthcare', 'media', 'marketing'] as const;

const FIELD_VARIANT: Record<string, HumaidanVariant> = {
  general: 'original',
  finance: 'finance',
  legal: 'legal',
  engineering: 'engineering',
  technology: 'tech',
  events: 'events',
  healthcare: 'healthcare',
  // Approved rule: media and marketing have no outfit of their own.
  media: 'original',
  marketing: 'original',
};

export function safeVariant(variant: string | null | undefined): HumaidanVariant {
  return variant && Object.hasOwn(HUMAIDAN_FILES, variant) ? (variant as HumaidanVariant) : 'original';
}

/** Assessment field, then the organization's industry, then Original. */
export function resolveHumaidan(assessmentField?: string | null, organizationIndustry?: string | null): HumaidanVariant {
  const field = assessmentField || organizationIndustry;
  return field && Object.hasOwn(FIELD_VARIANT, field) ? FIELD_VARIANT[field] : 'original';
}
