'use server';

import { revalidatePath } from 'next/cache';
import { api, errorCode } from './api';
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
