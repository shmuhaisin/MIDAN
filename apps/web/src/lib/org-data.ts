import 'server-only';
import { apiForPage } from './api';

/**
 * The employer workspace's data, read the same way on every page. Every call is scoped by the organization in the
 * address, and the API checks the signed-in member's role for each one: nothing here can reach another organization.
 */

export type Org = {
  id: string; name_ar: string; name_en: string; my_role: string; is_demo?: boolean;
  branding: { logo_path: string | null; primary_color: string | null; accent_color: string | null; industry?: string | null; welcome_ar?: string | null; welcome_en?: string | null; palette_status?: string | null } | null;
};
export type OrgJob = { id: string; title_ar: string; title_en: string; status: string; slug?: string; created_at?: string };
export type OrgApplication = {
  id: string; status: string; created_at: string; job_id?: string;
  jobs: { id?: string; title_ar: string; title_en: string };
  users: { email: string; candidate_profiles: { full_name: string; headline: string | null } | null };
};
export type OrgInterview = {
  id: string; application_id: string; scheduled_at: string; duration_minutes: number; time_zone: string; status: string;
  applicant: OrgApplication;
};
export type JobReport = {
  id: string; status: string;
  assessment_versions: { id: string; version_number: number; assessment_id: string; assessments: { title_ar: string; title_en: string } };
  applications: { profile_snapshot?: unknown; users?: { email: string } } & Record<string, unknown>;
  evaluation_results: { id: string; status: string; overall_score: string | number | null; released_to_candidate: boolean } | null;
}[];

export const canManageJobs = (role?: string) => ['owner', 'admin', 'recruiter'].includes(role ?? '');
export const canManageTeam = (role?: string) => ['owner', 'admin'].includes(role ?? '');

/** The hiring pipeline, grouped the way a team reads it, from the database's own statuses. */
export const PIPELINE = [
  ['new', ['submitted']],
  ['review', ['under_review']],
  ['assessment', ['assessment_invited', 'assessment_in_progress', 'assessment_submitted']],
  ['evaluated', ['evaluated']],
  ['shortlisted', ['shortlisted']],
  ['hired', ['hired']],
] as const;
export const CLOSED_STATUSES = ['rejected', 'withdrawn'];

export function stageOf(status: string) {
  return PIPELINE.find(([, statuses]) => (statuses as readonly string[]).includes(status))?.[0] ?? 'closed';
}

export async function orgBasics(orgId: string) {
  const [org, jobs, applications] = await Promise.all([
    apiForPage<Org>(`/organizations/${orgId}`),
    apiForPage<OrgJob[]>(`/organizations/${orgId}/jobs`),
    apiForPage<OrgApplication[]>(`/organizations/${orgId}/applications`),
  ]);
  return { org, jobs: jobs ?? [], applications: applications ?? [] };
}

/**
 * Interviews across the organization. The API lists them per application, so this asks for the applications that can
 * have one: an interview needs a shortlist first, and the outcome can then move the application on.
 */
export async function orgInterviews(orgId: string, applications: OrgApplication[], limit = 80): Promise<OrgInterview[]> {
  const candidates = applications.filter((a) => ['shortlisted', 'hired', 'rejected', 'under_review', 'evaluated'].includes(a.status)).slice(0, limit);
  const results = await Promise.all(candidates.map((a) =>
    apiForPage<{ interviews: Omit<OrgInterview, 'applicant'>[] }>(`/organizations/${orgId}/applications/${a.id}/interviews`)
      .then((r) => (r?.interviews ?? []).map((i) => ({ ...i, applicant: a })))
      .catch(() => [] as OrgInterview[]),
  ));
  return results.flat().sort((x, y) => new Date(x.scheduled_at).getTime() - new Date(y.scheduled_at).getTime());
}

/** Assessment attempts per job, from the per-job report. Only jobs that are or were published can have any. */
export async function orgJobReports(orgId: string, jobs: OrgJob[]) {
  const reportable = jobs.filter((j) => j.status !== 'draft');
  const reports = await Promise.all(reportable.map((j) => apiForPage<JobReport>(`/organizations/${orgId}/jobs/${j.id}/report`).catch(() => null)));
  return reportable.map((job, i) => ({ job, attempts: reports[i] ?? [] }));
}

/** Applications per week for the last `weeks` weeks, Saturday to Friday, from each application's own date. */
export function weeklyApplications(applications: OrgApplication[], weeks = 8, now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const day = 86400000;
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const to = new Date(end.getTime() - (weeks - 1 - i) * 7 * day);
    const from = new Date(to.getTime() - 7 * day + 1);
    return { from, to, count: 0 };
  });
  for (const a of applications) {
    const at = new Date(a.created_at).getTime();
    const b = buckets.find((x) => at >= x.from.getTime() && at <= x.to.getTime());
    if (b) b.count++;
  }
  return buckets;
}
