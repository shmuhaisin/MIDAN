// Organization review, shared by the employer's page and the platform console. The database is the authority
// (supabase/migrations/20261111090000_organization_verification.sql); this mirrors its rules so the page can say what's
// missing before the person submits.

export const REVIEW_STATUSES = ['draft', 'pending_review', 'changes_requested', 'rejected', 'approved', 'suspended'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const DOCUMENT_KINDS = ['commercial_registration', 'authorization_letter', 'tax_certificate', 'other'] as const;

export type OrganizationProfile = {
  id: string; slug: string; name_ar: string; name_en: string; company_type: string | null; industry: string | null;
  verification_status: ReviewStatus; verification_updated_at: string | null;
  commercial_registration: string | null; website: string | null; business_email: string | null; contact_phone: string | null; city: string | null;
  description_ar: string | null; description_en: string | null; representative_name: string | null; representative_title: string | null;
  is_demo: boolean; is_test: boolean; created_at: string; has_logo: boolean;
};
export type OrganizationDocument = { id: string; kind: string; file_name: string; mime_type: string; size_bytes: number; created_at: string };
export type ReviewRequest = {
  id: string; status: string; decision_note: string | null; reviewed_at: string | null; created_at: string;
  snapshot: Record<string, unknown> & { documents?: { id: string; kind: string; file_name: string }[]; previous_status?: string };
  submitted_by_email?: string | null; reviewed_by_email?: string | null;
};
export type VerificationState = { organization: OrganizationProfile; documents: OrganizationDocument[]; requests: ReviewRequest[] };

/** What review needs, in the order the form asks for it. Same list as public.submit_organization_verification. */
export const REQUIRED_FIELDS = [
  'name_ar', 'name_en', 'company_type', 'commercial_registration', 'business_email', 'contact_phone', 'city', 'representative_name', 'representative_title',
] as const;

export function missingForReview(state: Pick<VerificationState, 'organization' | 'documents'>) {
  const missing: string[] = REQUIRED_FIELDS.filter((key) => !String(state.organization[key] ?? '').trim());
  if (!state.documents.some((d) => d.kind === 'commercial_registration')) missing.push('document_commercial_registration');
  return missing;
}

/** While these hold, the organization edits its profile and documents and may submit. */
export const isEditable = (status: ReviewStatus) => status === 'draft' || status === 'changes_requested' || status === 'rejected';
/** Names and the commercial registration are locked once checked (or while being checked). */
export const identityLocked = (status: ReviewStatus) => status === 'pending_review' || status === 'approved' || status === 'suspended';

export const STATUS_TONE: Record<ReviewStatus, 'active' | 'danger' | 'neutral' | 'warning'> = {
  draft: 'neutral', pending_review: 'warning', changes_requested: 'warning', rejected: 'danger', approved: 'active', suspended: 'danger',
};
