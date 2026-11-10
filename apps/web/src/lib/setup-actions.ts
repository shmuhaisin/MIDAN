'use server';

// The company setup after a MIDAN administrator approves a representative: company details, the logo and the identity
// read from it, then the team. Each step saves through the real API and answers within a fixed time, so a stalled
// request ends in a message the person can act on instead of a button that spins forever.
import { revalidatePath } from 'next/cache';
import { api, ApiError, errorCode, errorDetail } from './api';
import type { FormState } from './auth-actions';
import type { ThemeColors } from './org-theme';

const QUICK = 20_000;

function text(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim();
}

function failed(error: unknown): FormState {
  if (error instanceof ApiError && error.status === 422 && /logo/i.test(error.detail ?? '')) return { error: 'palette_not_from_logo', detail: errorDetail(error) };
  return { error: errorCode(error), detail: errorDetail(error) };
}

/** Step 1: the company's field, type and welcome messages, saved together. */
export async function saveCompanyDetails(orgId: string, form: FormData): Promise<FormState> {
  const industry = text(form, 'industry');
  const companyType = text(form, 'company_type');
  if (!industry) return { error: 'required' };
  try {
    await api(`/organizations/${orgId}/branding`, {
      method: 'PATCH', timeoutMs: QUICK,
      body: { industry, welcome_ar: text(form, 'welcome_ar').slice(0, 600), welcome_en: text(form, 'welcome_en').slice(0, 600) },
    });
    if (companyType) await api(`/organizations/${orgId}/company-type`, { method: 'PATCH', timeoutMs: QUICK, body: { company_type: companyType } });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Step 2: the logo. The API reads its colours at once; `paletteError` says why when it couldn't. */
export async function uploadCompanyLogo(orgId: string, form: FormData): Promise<FormState & { paletteError?: string | null }> {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'required' };
  if (file.size > 2 * 1024 * 1024) return { error: 'too_large' };
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { error: 'logo_type' };
  try {
    const saved = await api<{ palette_error?: string | null }>(`/organizations/${orgId}/branding/logo`, { method: 'POST', form, timeoutMs: 60_000 });
    revalidatePath('/', 'layout');
    return { ok: true, paletteError: saved?.palette_error ?? null };
  } catch (error) {
    return failed(error);
  }
}

export async function rereadLogoColours(orgId: string): Promise<FormState> {
  try {
    await api(`/organizations/${orgId}/branding/palette/extract`, { method: 'POST', timeoutMs: 45_000 });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return { error: 'logo_unreadable', detail: errorDetail(error) };
    return failed(error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export type IdentityChoice = { primary: string; accent: string | null };

/** The themes a choice of the logo's colours would give. Saves nothing. */
export async function previewIdentity(orgId: string, choice: IdentityChoice): Promise<{ light?: ThemeColors; dark?: ThemeColors; error?: string }> {
  try {
    return await api<{ light: ThemeColors; dark: ThemeColors }>(`/organizations/${orgId}/branding/palette/preview`, { method: 'POST', timeoutMs: QUICK, body: choice });
  } catch (error) {
    return { error: failed(error).error };
  }
}

/** Approves the identity, as read from the logo or with other colours of the logo chosen by the representative. */
export async function approveIdentity(orgId: string, choice: IdentityChoice): Promise<FormState> {
  try {
    await api(`/organizations/${orgId}/branding/palette/approve`, { method: 'POST', timeoutMs: QUICK, body: choice });
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
