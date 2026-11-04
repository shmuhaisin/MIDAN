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

export async function saveProfile(_: FormState, form: FormData): Promise<FormState> {
  const full_name = text(form, 'full_name');
  if (!full_name) return { error: 'required' };
  try {
    await api('/me/candidate-profile', {
      method: 'PUT',
      body: {
        full_name,
        ...(text(form, 'headline') && { headline: text(form, 'headline') }),
        ...(text(form, 'city') && { city: text(form, 'city') }),
        share_profile_consent: form.get('share_profile_consent') === 'on',
      },
    });
  } catch (error) {
    return { error: errorCode(error) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
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
