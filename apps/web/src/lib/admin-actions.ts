'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError, errorCode } from './api';
import type { FormState } from './auth-actions';

async function run(work: () => Promise<unknown>): Promise<FormState> {
  try {
    await work();
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/[locale]/admin', 'layout');
  return { ok: true };
}

export async function resolveImportRecord(id: number, resolution: 'accepted' | 'dismissed') {
  return run(() => api(`/admin/import-records/${id}/resolve`, { method: 'POST', body: { resolution } }));
}

export async function reviewListing(id: string, action: string, registryId?: string, note?: string) {
  return run(() => api(`/admin/listings/${id}/review`, { method: 'POST', body: { action, ...(registryId && { registry_id: registryId }), ...(note && { note }) } }));
}

export async function addEmployerAlias(registryId: string, name: string, language: 'ar' | 'en') {
  if (!name.trim()) return { error: 'required' };
  return run(() => api(`/admin/employers/${registryId}/aliases`, { method: 'POST', body: { name: name.trim(), language } }));
}

export async function setPlatformAdmin(email: string, grant: boolean) {
  if (!email.trim()) return { error: 'required' };
  return run(() => api('/admin/admins', { method: 'POST', body: { email: email.trim().toLowerCase(), grant } }));
}

export async function retryBackgroundJob(id: string) {
  return run(() => api(`/admin/background-jobs/${id}/retry`, { method: 'POST' }));
}

export async function addLearningResource(input: {
  kind: 'course' | 'certification'; title_ar?: string; title_en?: string; provider: string; url: string; verified_on: string; reference_skill_id: string;
}) {
  if (!input.provider.trim() || !input.url.trim() || !input.reference_skill_id || !(input.title_ar || input.title_en)) return { error: 'required' };
  if (!/^https:\/\//.test(input.url)) return { error: 'https_only' };
  return run(() => api('/admin/learning-resources', { method: 'POST', body: input }));
}

export async function searchReferenceSkills(q: string): Promise<{ id: string; name_ar: string; sector_code: string }[]> {
  if (q.trim().length < 2) return [];
  try {
    return await api(`/reference/skills?q=${encodeURIComponent(q.trim())}`);
  } catch {
    return [];
  }
}

export async function linkOrganizationEmployer(orgId: string, registryId: string | null) {
  return run(() => api(`/admin/organizations/${orgId}/employer`, { method: 'POST', body: { registry_id: registryId } }));
}

export type ListingPreview = {
  file: string; sha256: string; format: string; total: number; can_import: boolean; counts: Record<string, number>; unknown_columns: string[]; missing_columns: string[];
  rows: { row: number; title: string | null; employer: string | null; status: string; errors: string[]; warnings: string[]; match_status?: string; registry_name_ar?: string | null; registry_name_en?: string | null }[];
};

/** Reasons the API gives for a file it can't read, which the screen explains. */
const uploadError = (error: unknown) => (error instanceof ApiError && error.status === 422 && error.detail && /^[a-z_]+$/.test(error.detail) ? `file_${error.detail}` : errorCode(error));

export async function previewListings(form: FormData): Promise<{ preview?: ListingPreview; error?: string }> {
  try {
    return { preview: await api<ListingPreview>('/admin/listings/preview', { method: 'POST', form }) };
  } catch (error) {
    return { error: uploadError(error) };
  }
}

export async function importListings(form: FormData): Promise<{ saved?: { run_id: string; counts: Record<string, number>; rejected: number; repeated: number }; error?: string }> {
  try {
    const saved = await api<{ run_id: string; counts: Record<string, number>; rejected: number; repeated: number }>('/admin/listings/import', { method: 'POST', form });
    revalidatePath('/[locale]/admin', 'layout');
    return { saved };
  } catch (error) {
    return { error: uploadError(error) };
  }
}

export async function convertListing(id: string) {
  return run(() => api(`/admin/listings/${id}/convert`, { method: 'POST' }));
}

export async function reviewEmployerClaim(id: string, decision: 'approved' | 'rejected', note: string) {
  if (decision === 'rejected' && !note.trim()) return { error: 'required' };
  return run(() => api(`/admin/employer-claims/${id}/review`, { method: 'POST', body: { decision, ...(note.trim() && { note: note.trim() }) } }));
}

export async function adminClaimEvidenceLink(id: string) {
  try {
    return { url: (await api<{ url: string }>(`/admin/employer-claims/${id}/evidence-url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}
