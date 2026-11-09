'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { api, ApiError, errorCode } from './api';
import type { FormState } from './auth-actions';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function text(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}

/** The optional reason a person gives for changing an assessment draft, kept in its change history. */
function reason(form: FormData) {
  const given = text(form, 'reason');
  return given ? { reason: given } : {};
}

export type ProfilePayload = {
  full_name: string; headline: string | null; city: string | null; summary: string | null; years_experience: number | null;
  share_profile_consent: boolean;
  phone: string | null;
  projects: { title: string; description?: string; year?: number | null }[];
  courses: { title: string; issuer?: string; year?: number | null }[];
  certifications: { title: string; issuer?: string; year?: number | null }[];
  education: { institution?: string; qualification: string; field?: string; start_year: number | null; end_year?: number | null }[];
  experience: { title: string; organization?: string; start_year: number | null; end_year?: number | null; description?: string }[];
  skill_ids: string[];
};

export async function saveProfile({ skill_ids, ...profile }: ProfilePayload): Promise<FormState> {
  if (!profile.full_name.trim()) return { error: 'required' };
  const backwards = [...profile.education, ...profile.experience].some((i) => i.end_year != null && i.start_year != null && i.end_year < i.start_year);
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
  const [title_ar, title_en] = [text(form, 'title_ar'), text(form, 'title_en')];
  const [description_ar, description_en] = [text(form, 'description_ar'), text(form, 'description_en')];
  // The description in at least one language: the requirements, AI assessment drafts and matching are built from it.
  if (!title_ar || !title_en || (!description_ar && !description_en)) return { error: 'required' };
  let created: { id?: string } | null;
  try {
    // The API makes the job's address from the English title.
    created = await api<{ id?: string } | null>(`/organizations/${orgId}/jobs`, {
      method: 'POST',
      body: { title_ar, title_en, ...(description_ar && { description_ar }), ...(description_en && { description_en }), status: 'draft' },
    });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  // The new draft's id, so the job wizard can carry on with it.
  return { ok: true, id: created?.id };
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
  // Only a form that shows the skills checklist changes them; otherwise the job's skills stay as they are (the API leaves
  // them alone when `skills` is absent).
  const skills = form.has('skills_present')
    ? form.getAll('skill').map(String).map((skill_id) => ({ skill_id, required_level: Number(form.get(`level-${skill_id}`) ?? 2) }))
    : undefined;
  return result(() =>
    api(`/organizations/${orgId}/jobs/${jobId}`, {
      method: 'PATCH',
      body: {
        title_ar, title_en, skills,
        description_ar: text(form, 'description_ar'), description_en: text(form, 'description_en'),
        requirements_ar: text(form, 'requirements_ar'), requirements_en: text(form, 'requirements_en'),
        location: text(form, 'location'),
        employment_type: text(form, 'employment_type') || null,
        sector: text(form, 'sector') || null,
        experience_level: text(form, 'experience_level') || null,
        salary_min: text(form, 'salary_min') ? Number(text(form, 'salary_min')) : null,
        salary_max: text(form, 'salary_max') ? Number(text(form, 'salary_max')) : null,
        application_deadline: text(form, 'application_deadline') || null,
      },
    }),
  );
}

export async function generateAssessment(orgId: string, jobId: string, assessmentId?: string) {
  return result(() =>
    api(`/organizations/${orgId}/jobs/${jobId}/assessment/generate`, { method: 'POST', body: assessmentId ? { assessment_id: assessmentId } : {} }),
  );
}

export async function addAssessment(orgId: string, jobId: string, form: FormData): Promise<FormState & { assessmentId?: string }> {
  const title_ar = text(form, 'title_ar');
  const title_en = text(form, 'title_en');
  if (!title_ar || !title_en) return { error: 'required' };
  try {
    const made = await api<{ assessment_id: string }>(`/organizations/${orgId}/jobs/${jobId}/assessment/generate`, { method: 'POST', body: { title_ar, title_en } });
    revalidatePath('/', 'layout');
    return { ok: true, assessmentId: made.assessment_id };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function renameAssessment(orgId: string, assessmentId: string, form: FormData) {
  const title_ar = text(form, 'title_ar');
  const title_en = text(form, 'title_en');
  if (!title_ar || !title_en) return { error: 'required' };
  return result(() => api(`/organizations/${orgId}/assessments/${assessmentId}`, { method: 'PATCH', body: { title_ar, title_en } }));
}

export async function removeAssessment(orgId: string, assessmentId: string) {
  return result(() => api(`/organizations/${orgId}/assessments/${assessmentId}`, { method: 'DELETE' }));
}

export async function updateTask(orgId: string, taskId: string, _: FormState, form: FormData): Promise<FormState> {
  return result(() =>
    api(`/organizations/${orgId}/assessment-tasks/${taskId}`, {
      method: 'PATCH',
      body: {
        title_ar: text(form, 'title_ar'), title_en: text(form, 'title_en'),
        instructions_ar: text(form, 'instructions_ar'), instructions_en: text(form, 'instructions_en'),
        weight: Number(form.get('weight')), ...reason(form),
      },
    }),
  );
}

export type QuestionInput = {
  id: string; prompt_ar: string; prompt_en: string; answer: string;
  options: { id: string; label_ar: string; label_en: string }[];
};

export async function saveQuestions(orgId: string, taskId: string, questions: QuestionInput[]) {
  return result(() => api(`/organizations/${orgId}/assessment-tasks/${taskId}/questions`, { method: 'PATCH', body: { questions } }));
}

export async function updateCriterion(orgId: string, id: string, _: FormState, form: FormData): Promise<FormState> {
  return result(() =>
    api(`/organizations/${orgId}/rubric-criteria/${id}`, {
      method: 'PATCH',
      body: {
        description_ar: text(form, 'description_ar'), description_en: text(form, 'description_en'),
        max_score: Number(form.get('max_score')), weight: Number(form.get('weight')), ...reason(form),
      },
    }),
  );
}

/** Approval. reviewedThrough is the last change the approver was shown: the database refuses it if the draft changed since. */
export async function publishVersion(orgId: string, versionId: string, reviewedThrough?: number) {
  return result(() => api(`/organizations/${orgId}/assessment-versions/${versionId}/publish`, {
    method: 'POST', body: reviewedThrough === undefined ? {} : { reviewed_through: reviewedThrough },
  }));
}

export async function reviewChanges(orgId: string, versionId: string, reviewedThrough: number, note: string) {
  return result(() => api(`/organizations/${orgId}/assessment-versions/${versionId}/review`, {
    method: 'POST', body: { reviewed_through: reviewedThrough, ...(note.trim() && { note: note.trim() }) },
  }));
}

/** A new draft version from an approved one. The approved version, and every attempt on it, stay as they are. */
export async function reviseVersion(orgId: string, versionId: string) {
  return result(() => api(`/organizations/${orgId}/assessment-versions/${versionId}/revise`, { method: 'POST' }));
}

export async function inviteCandidate(applicationId: string, assessmentId: string) {
  return result(() => api(`/applications/${applicationId}/invite`, { method: 'POST', body: { assessment_id: assessmentId } }));
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

export type RequirementInput = {
  requirement_type: string; description_ar: string | null; description_en: string | null; is_mandatory: boolean; min_years: number | null;
};

export async function saveRequirement(orgId: string, jobId: string, id: string | null, input: RequirementInput) {
  return result(() =>
    id
      ? api(`/organizations/${orgId}/job-requirements/${id}`, { method: 'PATCH', body: input })
      : api(`/organizations/${orgId}/jobs/${jobId}/requirements`, { method: 'POST', body: input }),
  );
}

export async function removeRequirement(orgId: string, id: string) {
  return result(() => api(`/organizations/${orgId}/job-requirements/${id}`, { method: 'DELETE' }));
}

export async function setTaskRequirements(orgId: string, taskId: string, requirementIds: string[]) {
  return result(() => api(`/organizations/${orgId}/assessment-tasks/${taskId}/requirements`, { method: 'PUT', body: { requirement_ids: requirementIds } }));
}

export async function analyzeJob(orgId: string, jobId: string) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/analyses`, { method: 'POST' }));
}

export async function acceptJobAnalysis(orgId: string, jobId: string, analysisId: string, skills: string[], required: string[], setSector: boolean, levels: Record<string, number | null> = {}) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/analyses/${analysisId}/accept`, { method: 'POST', body: { skills, required, set_sector: setSector, levels } }));
}

/** Suggestions that read the job's meaning; recorded as a job analysis for the employer to accept or dismiss. */
export async function suggestJobSkills(orgId: string, jobId: string) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/analyses/suggest`, { method: 'POST' }));
}

export type CatalogSkill = { id: string; name_ar: string; sector_code: string; skill_kind: string; is_priority: boolean | null; description_ar: string | null };

export async function searchReferenceSkills(orgId: string, q: string): Promise<{ items?: CatalogSkill[]; error?: string }> {
  try {
    return { items: await api<CatalogSkill[]>(`/organizations/${orgId}/reference-skills?q=${encodeURIComponent(q.slice(0, 100))}`) };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function linkJobSkill(orgId: string, jobId: string, referenceSkillId: string, isRequired: boolean, level: number | null) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/reference-skills`, { method: 'POST', body: { reference_skill_id: referenceSkillId, is_required: isRequired, required_level: level } }));
}

export async function updateJobSkill(orgId: string, jobId: string, referenceSkillId: string, change: { is_required?: boolean; required_level?: number | null }) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/reference-skills/${referenceSkillId}`, { method: 'PATCH', body: change }));
}

export async function removeJobSkill(orgId: string, jobId: string, referenceSkillId: string) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/reference-skills/${referenceSkillId}`, { method: 'DELETE' }));
}

export async function addCustomSkill(orgId: string, jobId: string, _: FormState, form: FormData): Promise<FormState> {
  const level = String(form.get('required_level') ?? '');
  const body = {
    name_ar: text(form, 'name_ar') || undefined, name_en: text(form, 'name_en') || undefined, description: text(form, 'description') || undefined,
    is_required: form.get('is_required') === 'on', required_level: /^[0-4]$/.test(level) ? Number(level) : null,
  };
  if (!body.name_ar && !body.name_en) return { error: 'required' };
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/custom-skills`, { method: 'POST', body }));
}

export async function updateCustomSkill(orgId: string, jobId: string, id: string, change: { is_required?: boolean; required_level?: number | null }) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/custom-skills/${id}`, { method: 'PATCH', body: change }));
}

export async function removeCustomSkill(orgId: string, jobId: string, id: string) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/custom-skills/${id}`, { method: 'DELETE' }));
}

export async function dismissJobAnalysis(orgId: string, jobId: string, analysisId: string) {
  return result(() => api(`/organizations/${orgId}/jobs/${jobId}/analyses/${analysisId}/dismiss`, { method: 'POST' }));
}

export async function addTask(orgId: string, versionId: string, _: FormState, form: FormData): Promise<FormState> {
  const body = {
    task_type: text(form, 'task_type'), title_ar: text(form, 'title_ar'), title_en: text(form, 'title_en'),
    instructions_ar: text(form, 'instructions_ar'), instructions_en: text(form, 'instructions_en'),
    criteria: [{ description_ar: text(form, 'criterion_ar'), description_en: text(form, 'criterion_en'), max_score: Number(form.get('max_score')) }],
    ...reason(form),
  };
  if (!body.title_ar || !body.title_en || !body.instructions_ar || !body.instructions_en || !body.criteria[0].description_ar || !body.criteria[0].description_en) return { error: 'required' };
  return result(() => api(`/organizations/${orgId}/assessment-versions/${versionId}/tasks`, { method: 'POST', body }));
}

/** One draft task written again by the AI model. Without the model the API answers 503, and the person is told so: no templates. */
export async function regenerateTask(orgId: string, taskId: string, note: string): Promise<FormState> {
  try {
    await api(`/organizations/${orgId}/assessment-tasks/${taskId}/regenerate`, { method: 'POST', body: note.trim() ? { note: note.trim().slice(0, 500) } : {} });
  } catch (error) {
    return { error: error instanceof ApiError && error.status === 503 ? 'ai_unavailable' : errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function removeTask(orgId: string, taskId: string) {
  return result(() => api(`/organizations/${orgId}/assessment-tasks/${taskId}`, { method: 'DELETE' }));
}

/** Saves a draft's new task order: every task once, top to bottom. Ids, rubrics and links don't change. */
export async function reorderTasks(orgId: string, versionId: string, taskIds: string[]) {
  return result(() => api(`/organizations/${orgId}/assessment-versions/${versionId}/task-order`, { method: 'PUT', body: { task_ids: taskIds } }));
}

export async function addCriterion(orgId: string, taskId: string, _: FormState, form: FormData): Promise<FormState> {
  const body = { description_ar: text(form, 'description_ar'), description_en: text(form, 'description_en'), max_score: Number(form.get('max_score')), ...reason(form) };
  if (!body.description_ar || !body.description_en || !(body.max_score > 0)) return { error: 'required' };
  return result(() => api(`/organizations/${orgId}/assessment-tasks/${taskId}/criteria`, { method: 'POST', body }));
}

export async function removeCriterion(orgId: string, criterionId: string) {
  return result(() => api(`/organizations/${orgId}/rubric-criteria/${criterionId}`, { method: 'DELETE' }));
}

export async function inviteMember(orgId: string, email: string, role: string) {
  if (!email.trim()) return { error: 'required' };
  return result(() => api(`/organizations/${orgId}/team/invitations`, { method: 'POST', body: { email: email.trim().toLowerCase(), role } }));
}

export async function revokeInvitation(orgId: string, id: string) {
  return result(() => api(`/organizations/${orgId}/team/invitations/${id}`, { method: 'DELETE' }));
}

export async function changeMemberRole(orgId: string, userId: string, role: string) {
  return result(() => api(`/organizations/${orgId}/team/members/${userId}`, { method: 'PATCH', body: { role } }));
}

export async function removeMember(orgId: string, userId: string) {
  return result(() => api(`/organizations/${orgId}/team/members/${userId}`, { method: 'DELETE' }));
}

export async function acceptInvitation(id: string): Promise<{ org_id?: string; error?: string }> {
  try {
    const accepted = await api<{ org_id: string }>(`/me/invitations/${id}/accept`, { method: 'POST' });
    revalidatePath('/', 'layout');
    return accepted;
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function declineInvitation(id: string) {
  return result(() => api(`/me/invitations/${id}/decline`, { method: 'POST' }));
}

export async function submitEmployerClaim(orgId: string, form: FormData): Promise<FormState> {
  const file = form.get('file');
  if (file instanceof File && file.size === 0) form.delete('file');
  return result(() => api(`/organizations/${orgId}/employer-claims`, { method: 'POST', form }));
}

export async function withdrawEmployerClaim(orgId: string, id: string) {
  return result(() => api(`/organizations/${orgId}/employer-claims/${id}/withdraw`, { method: 'POST' }));
}

export async function claimEvidenceLink(orgId: string, id: string) {
  try {
    return { url: (await api<{ url: string }>(`/organizations/${orgId}/employer-claims/${id}/evidence-url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function convertOrganizationListing(orgId: string, id: string) {
  return result(() => api(`/organizations/${orgId}/listings/${id}/convert`, { method: 'POST' }));
}

/** Runs MIDAN's quality check on a draft and records the report (staff only; the API decides who). */
export async function runQualityCheck(orgId: string, versionId: string): Promise<FormState> {
  try {
    await api(`/organizations/${orgId}/assessment-versions/${versionId}/quality`, { method: 'POST' });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function setCompanyType(orgId: string, companyType: string): Promise<FormState> {
  try {
    await api(`/organizations/${orgId}/company-type`, { method: 'PATCH', body: { company_type: companyType } });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
