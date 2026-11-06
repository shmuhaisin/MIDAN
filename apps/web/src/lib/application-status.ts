/**
 * The statuses a staff member can move an application to by hand, from each status.
 * Must match private.manual_status_change_allowed in supabase/migrations/20261107090100_application_status_transitions.sql,
 * which enforces it. Hiring also waits until every assessment is reviewed; the database says so with a 422.
 * Assessment stages, outcomes and withdrawal are set elsewhere.
 */
const ASSESSMENT_STAGES = ['assessment_invited', 'assessment_in_progress', 'assessment_submitted'];

export const MANUAL_STATUS_CHANGES: Record<string, string[]> = {
  submitted: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'rejected'],
  ...Object.fromEntries(ASSESSMENT_STAGES.map((stage) => [stage, ['shortlisted', 'rejected']])),
  evaluated: ['shortlisted', 'rejected', 'hired'],
  shortlisted: ['rejected', 'hired'],
  rejected: ['under_review', 'shortlisted'],
  hired: [],
  withdrawn: [],
};

/** The current status first, then where it can go. */
export function statusOptions(current: string) {
  return [current, ...(MANUAL_STATUS_CHANGES[current] ?? [])];
}
