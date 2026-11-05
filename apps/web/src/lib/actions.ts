'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { api, errorCode } from './api';
import type { FormState } from './auth-actions';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function text(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}

export type ProfilePayload = {
  full_name: string; headline: string | null; city: string | null; summary: string | null; years_experience: number | null;
  share_profile_consent: boolean;
  education: { institution: string; qualification: string; field?: string; start_year: number; end_year?: number | null }[];
  experience: { title: string; organization: string; start_year: number; end_year?: number | null; description?: string }[];
  skill_ids: string[];
};

export async function saveProfile({ skill_ids, ...profile }: ProfilePayload): Promise<FormState> {
  if (!profile.full_name.trim()) return { error: 'required' };
  const backwards = [...profile.education, ...profile.experience].some((i) => i.end_year != null && i.end_year < i.start_year);
  if (backwards) return { error: 'invalid_years' };
  try {
    await api('/me/candidate-profile', { method: 'PUT', body: profile });
    await api('/me/skills', { method: 'PUT', body: { skill_ids } });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function uploadCv(form: FormData) {
  return result(() => api('/me/cv', { method: 'POST', form }));
}

export async function removeCv() {
  return result(() => api('/me/cv', { method: 'DELETE' }));
}

export async function myCvLink(): Promise<{ url?: string; error?: string }> {
  try {
    return { url: (await api<{ url: string }>('/me/cv/url')).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function applicantCvLink(applicationId: string): Promise<{ url?: string; error?: string }> {
  try {
    return { url: (await api<{ url: string }>(`/applications/${applicationId}/cv-url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function applyToJob(jobId: string): Promise<FormState> {
  try {
    await api(`/jobs/${jobId}/applications`, { method: 'POST', body: {} });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function withdrawApplication(id: string): Promise<FormState> {
  try {
    await api(`/applications/${id}/withdraw`, { method: 'POST' });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const [slug, name_ar, name_en] = [text(form, 'slug'), text(form, 'name_ar'), text(form, 'name_en')];
  if (!slug || !name_ar || !name_en) return { error: 'required' };
  if (!SLUG.test(slug)) return { error: 'invalid_slug' };
  let id: string;
  try {
    ({ id } = await api<{ id: string }>('/organizations', { method: 'POST', body: { slug, name_ar, name_en } }));
  } catch (error) {
    return { error: errorCode(error) };
  }
  redirect({ href: `/organization/${id}`, locale: await getLocale() });
  return {};
}

export async function createJob(orgId: string, _: FormState, form: FormData): Promise<FormState> {
  const [slug, title_ar, title_en] = [text(form, 'slug'), text(form, 'title_ar'), text(form, 'title_en')];
  if (!slug || !title_ar || !title_en) return { error: 'required' };
  if (!SLUG.test(slug)) return { error: 'invalid_slug' };
  try {
    await api(`/organizations/${orgId}/jobs`, { method: 'POST', body: { slug, title_ar, title_en, status: 'draft' } });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function setJobStatus(orgId: string, jobId: string, status: string): Promise<FormState> {
  try {
    await api(`/organizations/${orgId}/jobs/${jobId}/status`, { method: 'PATCH', body: { status } });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function setApplicationStatus(id: string, status: string): Promise<FormState> {
  try {
    await api(`/applications/${id}/status`, { method: 'PATCH', body: { status } });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

function result(run: () => Promise<unknown>): Promise<FormState> {
  return run().then(
    () => {
      revalidatePath('/', 'layout');
      return { ok: true };
    },
    (error) => ({ error: errorCode(error) }),
  );
}

export async function updateJob(orgId: string, jobId: string, _: FormState, form: FormData): Promise<FormState> {
  const title_ar = text(form, 'title_ar');
  const title_en = text(form, 'title_en');
  if (!title_ar || !title_en) return { error: 'required' };
  const skills = form.getAll('skill').map(String).map((skill_id) => ({
    skill_id,
    required_level: Number(form.get(`level-${skill_id}`) ?? 2),
  }));
  return result(() =>
    api(`/organizations/${orgId}/jobs/${jobId}`, {
      method: 'PATCH',
      body: {
        title_ar, title_en, skills,
        description_ar: text(form, 'description_ar'), description_en: text(form, 'description_en'),
        requirements_ar: text(form, 'requirements_ar'), requirements_en: text(form, 'requirements_en'),
        location: text(form, 'location'),
      },
    }),
  );
}

export async function generateAssessment(orgId: string, jobId: string) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/assessment/generate`, { method: 'POST' }));
}

export async function updateTask(orgId: string, taskId: string, _: FormState, form: FormData): Promise<FormState> {
  return result(() =>
    api(`/organizations/${orgId}/assessment-tasks/${taskId}`, {
      method: 'PATCH',
      body: {
        title_ar: text(form, 'title_ar'), title_en: text(form, 'title_en'),
        instructions_ar: text(form, 'instructions_ar'), instructions_en: text(form, 'instructions_en'),
        weight: Number(form.get('weight')),
      },
    }),
  );
}

export async function updateCriterion(orgId: string, id: string, _: FormState, form: FormData): Promise<FormState> {
  return result(() =>
    api(`/organizations/${orgId}/rubric-criteria/${id}`, {
      method: 'PATCH',
      body: {
        description_ar: text(form, 'description_ar'), description_en: text(form, 'description_en'),
        max_score: Number(form.get('max_score')), weight: Number(form.get('weight')),
      },
    }),
  );
}

export async function publishVersion(orgId: string, versionId: string) {
  return result(() => api(`/organizations/${orgId}/assessment-versions/${versionId}/publish`, { method: 'POST' }));
}

export async function inviteCandidate(applicationId: string) {
  return result(() => api(`/applications/${applicationId}/invite`, { method: 'POST' }));
}

export async function startAttempt(id: string) {
  return result(() => api(`/attempts/${id}/start`, { method: 'POST' }));
}

/** Autosave: no revalidation, so typing never re-renders the page. */
export async function saveAnswer(attemptId: string, taskId: string, answer: Record<string, unknown>): Promise<FormState> {
  try {
    await api(`/attempts/${attemptId}/responses/${taskId}`, { method: 'PUT', body: { answer } });
    return { ok: true };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function uploadEvidence(attemptId: string, taskId: string, form: FormData): Promise<FormState & { file?: { id: string; file_name: string } }> {
  try {
    const file = await api<{ id: string; file_name: string }>(`/attempts/${attemptId}/evidence/${taskId}`, { method: 'POST', form });
    return { ok: true, file };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function submitAttempt(id: string) {
  return result(() => api(`/attempts/${id}/submit`, { method: 'POST' }));
}

export async function runEvaluation(attemptId: string) {
  return result(() => api(`/attempts/${attemptId}/evaluate`, { method: 'POST' }));
}

export async function submitReview(evaluationId: string, scores: { criterion_id: string; score: number }[], notes: string) {
  return result(() => api(`/evaluations/${evaluationId}/review`, { method: 'POST', body: { scores, ...(notes.trim() && { notes }) } }));
}

export async function releaseResult(evaluationId: string) {
  return result(() => api(`/evaluations/${evaluationId}/release`, { method: 'POST' }));
}

export async function evidenceLink(id: string): Promise<{ url?: string; error?: string }> {
  try {
    return { url: (await api<{ url: string }>(`/evidence/${id}/url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function setAssessmentField(orgId: string, assessmentId: string, field: string | null) {
  return result(() => api(`/organizations/${orgId}/assessments/${assessmentId}/field`, { method: 'PATCH', body: { professional_field: field } }));
}

export async function saveBranding(orgId: string, _: FormState, form: FormData): Promise<FormState> {
  const color = (name: string) => text(form, name) || undefined;
  return result(() =>
    api(`/organizations/${orgId}/branding`, {
      method: 'PATCH',
      body: {
        ...(text(form, 'industry') && { industry: text(form, 'industry') }),
        primary_color: color('primary_color'), accent_color: color('accent_color'),
        welcome_ar: text(form, 'welcome_ar'), welcome_en: text(form, 'welcome_en'),
      },
    }),
  );
}

export async function uploadLogo(orgId: string, form: FormData) {
  return result(() => api(`/organizations/${orgId}/branding/logo`, { method: 'POST', form }));
}
