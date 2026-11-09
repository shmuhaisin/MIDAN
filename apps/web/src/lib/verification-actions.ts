'use server';

// Server actions for organization review. Each calls the API as the signed-in person; the API and the database decide.
import { revalidatePath } from 'next/cache';
import { api, errorCode } from './api';
import type { FormState } from './auth-actions';

async function run(work: () => Promise<unknown>, path = '/[locale]/organization/[orgId]'): Promise<FormState> {
  try {
    await work();
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath(path, 'layout');
  return { ok: true };
}

const PROFILE_KEYS = [
  'name_ar', 'name_en', 'company_type', 'industry', 'commercial_registration', 'website', 'business_email', 'contact_phone', 'city',
  'description_ar', 'description_en', 'representative_name', 'representative_title',
] as const;

/** Saves only the fields the form sends; an empty field clears it. Locked fields aren't sent by the form. */
export async function saveOrganizationProfile(orgId: string, _: FormState, form: FormData): Promise<FormState> {
  const body: Record<string, string | null> = {};
  for (const key of PROFILE_KEYS) {
    if (!form.has(key)) continue;
    const value = String(form.get(key) ?? '').trim();
    body[key] = value === '' ? null : key === 'commercial_registration' ? value.replace(/\s+/g, '') : value;
  }
  // Names can't be cleared.
  if (body.name_ar === null || body.name_en === null) return { error: 'required' };
  return run(() => api(`/organizations/${orgId}/profile`, { method: 'PATCH', body }));
}

export async function uploadOrganizationDocument(orgId: string, form: FormData): Promise<FormState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'required' };
  if (file.size > 10 * 1024 * 1024) return { error: 'too_large' };
  return run(() => api(`/organizations/${orgId}/verification/documents`, { method: 'POST', form }));
}

export async function removeOrganizationDocument(orgId: string, id: string): Promise<FormState> {
  return run(() => api(`/organizations/${orgId}/verification/documents/${id}`, { method: 'DELETE' }));
}

export async function organizationDocumentLink(orgId: string, id: string) {
  try {
    return { url: (await api<{ url: string }>(`/organizations/${orgId}/verification/documents/${id}/url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}

export async function submitOrganizationForReview(orgId: string): Promise<FormState> {
  return run(() => api(`/organizations/${orgId}/verification/submit`, { method: 'POST' }));
}

// Platform administrators -------------------------------------------------------------------------------------------

export async function decideOrganization(id: string, decision: 'approve' | 'reject' | 'request_changes', note: string): Promise<FormState> {
  if (decision !== 'approve' && !note.trim()) return { error: 'reason_required' };
  return run(() => api(`/admin/organizations/${id}/decision`, { method: 'POST', body: { decision, ...(note.trim() && { note: note.trim() }) } }), '/[locale]/admin');
}

export async function setOrganizationSuspension(id: string, suspend: boolean, reason: string): Promise<FormState> {
  if (!reason.trim()) return { error: 'reason_required' };
  return run(() => api(`/admin/organizations/${id}/suspension`, { method: 'POST', body: { suspend, reason: reason.trim() } }), '/[locale]/admin');
}

export async function adminOrganizationDocumentLink(id: string, docId: string) {
  try {
    return { url: (await api<{ url: string }>(`/admin/organizations/${id}/documents/${docId}/url`)).url };
  } catch (error) {
    return { error: errorCode(error) };
  }
}
