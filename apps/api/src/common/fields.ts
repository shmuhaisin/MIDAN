/** Must match the check constraints on organization_branding.industry and assessments.professional_field. */
export const PROFESSIONAL_FIELDS = ['general', 'finance', 'legal', 'engineering', 'technology', 'events', 'healthcare', 'media', 'marketing'];

/** Must match the check constraint on organizations.company_type and COMPANY_TYPES in services/ai/midan_ai/standard.py. */
export const COMPANY_TYPES = ['private_company', 'startup', 'sme', 'large_enterprise', 'government_entity', 'semi_government', 'nonprofit', 'multinational'];
