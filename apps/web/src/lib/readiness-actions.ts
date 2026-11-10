'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError, errorCode } from './api';

export type ReadinessResult = { ok?: boolean; id?: string; error?: string; reason?: string };

/** The model's own reason when it wasn't available (quota_exhausted, rate_limited, not_configured...), for an exact message. */
function reasonOf(error: unknown) {
  return error instanceof ApiError && error.status === 503 ? /\(([a-z_]+)\)/.exec(error.detail ?? '')?.[1] : undefined;
}

export async function startReadiness(targetTitle: string, locale: 'ar' | 'en'): Promise<ReadinessResult> {
  try {
    const row = await api<{ id: string }>('/me/career/readiness', { method: 'POST', body: { target_title: targetTitle.trim(), locale }, timeoutMs: 300_000 });
    revalidatePath('/', 'layout');
    return { ok: true, id: row.id };
  } catch (error) {
    return { error: errorCode(error), reason: reasonOf(error) };
  }
}

export async function answerReadiness(id: string, answers: { question_id: string; text: string }[]): Promise<ReadinessResult> {
  try {
    await api(`/me/career/readiness/${id}/answers`, { method: 'POST', body: { answers }, timeoutMs: 300_000 });
    revalidatePath('/', 'layout');
    return { ok: true, id };
  } catch (error) {
    return { error: errorCode(error), reason: reasonOf(error) };
  }
}
