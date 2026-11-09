'use server';

import { api, errorCode } from './api';
import type { Lang } from './translation';

export type TranslateOutcome = { text?: string; reason?: string };

/** One field translated by the live model through the API (POST /organizations/:orgId/translate). Never invented text. */
export async function translateField(orgId: string, key: string, source: Lang, target: Lang, text: string): Promise<TranslateOutcome> {
  if (!text.trim()) return { reason: 'empty' };
  try {
    const result = await api<{ ok: boolean; reason?: string; translations?: { key: string; text: string }[] }>(`/organizations/${orgId}/translate`, {
      method: 'POST', body: { source, target, fields: [{ key, text: text.slice(0, 8000) }] },
    });
    if (!result.ok) return { reason: result.reason ?? 'unavailable' };
    const found = result.translations?.find((t) => t.key === key)?.text;
    return found ? { text: found } : { reason: 'invalid_reply' };
  } catch (error) {
    return { reason: errorCode(error) };
  }
}
