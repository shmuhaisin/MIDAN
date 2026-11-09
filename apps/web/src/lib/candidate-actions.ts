'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { api, errorCode } from './api';
import type { FormState } from './auth-actions';

function done(run: () => Promise<unknown>): Promise<FormState> {
  return run().then(
    () => {
      revalidatePath('/', 'layout');
      return { ok: true };
    },
    (error) => ({ error: errorCode(error) }),
  );
}

/** Applies, then goes to the application's own page. A repeated click arrives at the same application. */
export async function submitApplication(jobId: string, coverNote: string): Promise<FormState> {
  let id: string;
  try {
    const made = await api<{ id: string }>(`/jobs/${jobId}/applications`, { method: 'POST', body: coverNote.trim() ? { cover_note: coverNote.trim() } : {} });
    id = made.id;
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  redirect({ href: `/applications/${id}?new=1`, locale: await getLocale() });
  return {};
}

export async function shareCvWithApplication(id: string): Promise<FormState> {
  const result = await done(() => api(`/me/applications/${id}/share-cv`, { method: 'POST' }));
  if (!result.error) revalidatePath('/', 'layout');
  return result;
}

export async function applicationCvLink(id: string) {
  try {
    return { url: (await api<{ url: string }>(`/me/applications/${id}/cv-url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function saveOnboarding(step: number, completed = false) {
  return done(() => api('/me/onboarding', { method: 'PATCH', body: { step, completed } }));
}

export async function saveBasics(body: { full_name: string; phone: string | null; city: string | null; headline: string | null }) {
  if (!body.full_name.trim()) return { error: 'required' };
  return done(() => api('/me/candidate-profile', { method: 'PUT', body }));
}

export type HistoryItem = Record<string, string | number | null | undefined>;

/** Saves one list of the profile (education or experience) on its own: the API updates only what it's sent. */
export async function saveProfileList(fullName: string, kind: 'education' | 'experience', items: HistoryItem[]) {
  if (!fullName.trim()) return { error: 'required' } as FormState;
  const backwards = items.some((i) => typeof i.end_year === 'number' && typeof i.start_year === 'number' && i.end_year < i.start_year);
  if (backwards) return { error: 'invalid_years' } as FormState;
  return done(() => api('/me/candidate-profile', { method: 'PUT', body: { full_name: fullName, [kind]: items } }));
}

export async function setReferenceSkills(ids: string[]) {
  return done(() => api('/me/reference-skills', { method: 'PUT', body: { ids } }));
}

export async function setOwnSkills(names: string[]) {
  return done(() => api('/me/own-skills', { method: 'PUT', body: { names } }));
}

export type ReferenceSkill = { id: string; name_ar: string; description_ar: string | null; sector_code: string; skill_kind: string; job_families: string[] };

export async function searchReferenceSkills(q: string): Promise<{ results: ReferenceSkill[]; error?: string }> {
  if (q.trim().length < 2) return { results: [] };
  try {
    return { results: await api<ReferenceSkill[]>(`/reference/skills?q=${encodeURIComponent(q.trim())}`) };
  } catch (error) {
    return { results: [], error: errorCode(error) };
  }
}

export type CvAnalysis = {
  id: string; status: string; failure_code: string | null; mode: string | null;
  personal: { full_name: string | null; email: string | null; phone: string | null; city: string | null; links: string[] } | null;
  professional: {
    headline: string | null; summary: string | null; years_experience: number | null;
    /** One entry per position, with the responsibilities written under it in the CV. */
    experience: { title: string; organization?: string | null; description?: string | null; start_year?: number | null; end_year?: number | null; current?: boolean; responsibilities?: string[] }[];
    education: { qualification: string; field?: string | null; institution?: string | null; start_year?: number | null; end_year?: number | null }[];
    skills: string[];
    projects: { title: string; description?: string | null }[];
    courses: { title: string }[];
    certifications: { title: string }[];
    languages?: { name: string; level?: string | null }[];
    achievements?: { title: string; description?: string | null }[];
    /** Each skill with its kind and the CV line that shows it, quoted as written. No line, no evidence. */
    skill_details?: { name: string; kind: 'technical' | 'general' | 'unclassified'; evidence: string | null }[];
    /** MIDAN's rule-based suggestions about the CV. Not facts about the candidate, and not a score. */
    feedback?: { type: 'strength' | 'gap'; code: string; values: string[] }[];
    uncertain: string[];
  } | null;
  redaction_counts: Record<string, number> | null;
};

export async function readAnalysis(id: string): Promise<CvAnalysis | null> {
  try {
    return await api<CvAnalysis>(`/me/cv/analyses/${id}`);
  } catch {
    return null;
  }
}

export async function retryAnalysis(): Promise<FormState & { id?: string }> {
  try {
    const made = await api<{ id: string }>('/me/cv/analyses', { method: 'POST' });
    return { ok: true, id: made.id };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function applyAnalysis(id: string, body: Record<string, unknown>) {
  return done(() => api(`/me/cv/analyses/${id}/apply`, { method: 'POST', body }));
}

export async function dismissAnalysis(id: string) {
  return done(() => api(`/me/cv/analyses/${id}/dismiss`, { method: 'POST' }));
}

/** Saves a published job for later, or removes it from the saved list. */
export async function saveJob(jobId: string, save: boolean) {
  return done(() => api(`/me/saved-jobs/${jobId}`, { method: save ? 'PUT' : 'DELETE' }));
}

export async function respondToInterview(id: string, action: 'accept' | 'request_reschedule', note?: string) {
  return done(() => api(`/interviews/${id}/respond`, { method: 'POST', body: { action, ...(note?.trim() && { note: note.trim() }) } }));
}

/** The token goes straight to the embedded call. It's short-lived and only opens this interview's room. */
export async function joinInterview(id: string): Promise<{ room_url?: string; token?: string; error?: string }> {
  try {
    return await api<{ room_url: string; token: string }>(`/interviews/${id}/join`, { method: 'POST' });
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function readNotification(id: string) {
  return done(() => api(`/me/notifications/${id}/read`, { method: 'POST' }));
}

export async function readAllNotifications() {
  return done(() => api('/me/notifications/read-all', { method: 'POST' }));
}

export async function setCareerTarget(target: { job_title?: string; sector_code?: string; job_family_ar?: string }) {
  return done(() => api('/me/career/target', { method: 'PUT', body: target }));
}

export async function startPractice(reference_skill_id: string, kind: 'simulated_task' | 'portfolio_project') {
  return done(() => api('/me/career/practice', { method: 'POST', body: { reference_skill_id, kind } }));
}

export async function updatePractice(id: string, body: { action: 'start' | 'save' | 'submit' | 'complete'; submission?: string; submission_url?: string }) {
  return done(() => api(`/me/career/practice/${id}`, { method: 'PATCH', body }));
}

export async function addPlanItem(body: { reference_skill_id: string; kind: string; resource_id?: string }) {
  return done(() => api('/me/career/plan', { method: 'POST', body }));
}

export async function setPlanStatus(id: string, status: string) {
  return done(() => api(`/me/career/plan/${id}`, { method: 'PATCH', body: { status } }));
}

export async function removePlanItem(id: string) {
  return done(() => api(`/me/career/plan/${id}`, { method: 'DELETE' }));
}

export async function saveSettings(body: { time_zone: string; notification_prefs: { deadline_reminders: boolean }; full_name: string }) {
  return done(() => api('/me/candidate-profile', { method: 'PUT', body }));
}

// Small additions on the organization side, only what the candidate journey depends on.

export async function scheduleInterview(orgId: string, applicationId: string, body: Record<string, unknown>) {
  return done(() => api(`/organizations/${orgId}/applications/${applicationId}/interviews`, { method: 'POST', body }));
}

export async function updateInterview(orgId: string, id: string, body: Record<string, unknown>) {
  return done(() => api(`/organizations/${orgId}/interviews/${id}`, { method: 'PATCH', body }));
}

export async function retryInterviewCalendar(orgId: string, id: string) {
  return done(() => api(`/organizations/${orgId}/interviews/${id}/calendar-retry`, { method: 'POST' }));
}

export async function issueOutcome(orgId: string, applicationId: string, body: Record<string, unknown>) {
  return done(() => api(`/organizations/${orgId}/applications/${applicationId}/outcome`, { method: 'POST', body }));
}

export async function saveVersionSettings(orgId: string, versionId: string, body: Record<string, unknown>) {
  return done(() => api(`/organizations/${orgId}/assessment-versions/${versionId}`, { method: 'PATCH', body }));
}

/** A staff member confirms or corrects one of MIDAN's proposed requirement matches. Never changes the application. */
export async function reviewRequirementMatch(orgId: string, applicationId: string, body: { requirement_key: string; status: string; proposed_status: string; note?: string }) {
  return done(() => api(`/organizations/${orgId}/applications/${applicationId}/match/reviews`, { method: 'POST', body }));
}

export async function addApplicationNote(orgId: string, applicationId: string, body: string) {
  return done(() => api(`/organizations/${orgId}/applications/${applicationId}/notes`, { method: 'POST', body: { body } }));
}

export async function saveInterviewFeedback(orgId: string, applicationId: string, interviewId: string, body: Record<string, unknown>) {
  return done(() => api(`/organizations/${orgId}/applications/${applicationId}/interviews/${interviewId}/feedback`, { method: 'PUT', body }));
}
