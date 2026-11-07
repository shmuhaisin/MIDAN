/**
 * The statuses a staff member can move an application to by hand, from each status.
 * Must match private.manual_status_change_allowed in supabase/migrations/20261108090200_status_changes_and_notifications.sql,
 * which enforces it. Hiring also waits until every assessment is reviewed; the database says so with a 422.
 * Reopening a rejected application is for owners and admins, as in public.set_application_status.
 * Assessment stages, outcomes and withdrawal are set elsewhere.
 */
const ASSESSMENT_STAGES = ['assessment_invited', 'assessment_in_progress', 'assessment_submitted'];

export const MANUAL_STATUS_CHANGES: Record<string, string[]> = {
  submitted: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'rejected'],
  ...Object.fromEntries(ASSESSMENT_STAGES.map((stage) => [stage, ['shortlisted', 'rejected']])),
  evaluated: ['shortlisted', 'rejected', 'hired'],
  // Back to review undoes a shortlist without rejecting anyone (20261108090200).
  shortlisted: ['under_review', 'rejected', 'hired'],
  rejected: ['under_review', 'shortlisted'],
  hired: [],
  withdrawn: [],
};

/** The current status first, then where it can go. */
export function statusOptions(current: string, canReopen = false) {
  if (current === 'rejected' && !canReopen) return [current];
  return [current, ...(MANUAL_STATUS_CHANGES[current] ?? [])];
}

export const canReopenApplications = (role?: string) => ['owner', 'admin'].includes(role ?? '');
