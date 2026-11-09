'use server';

import { api, ApiError } from './api';

export type AssistantReply = {
  answer: string;
  facts: { id: string; text: string }[];
  links: { key: string; href: string; label: string }[];
  mode: 'live' | 'retrieval_only';
  grounded: boolean;
};

/**
 * Asks MIDAN's assistant. The API retrieves what the asker may see and answers from it; nothing here acts. Links are
 * in-app paths only (the AI service refuses anything else), and the organization's id is checked by the API's role check.
 */
export async function askAssistant(input: { scope: 'candidate' | 'organization'; orgId?: string; question: string; locale: 'ar' | 'en'; history: { role: 'user' | 'assistant'; text: string }[] }): Promise<{ reply?: AssistantReply; error?: string }> {
  if (input.scope === 'organization' && !/^[0-9a-f-]{36}$/.test(input.orgId ?? '')) return { error: 'forbidden' };
  const path = input.scope === 'candidate' ? '/me/assistant' : `/organizations/${input.orgId}/assistant`;
  try {
    return { reply: await api<AssistantReply>(path, { method: 'POST', body: { question: input.question.slice(0, 1000), locale: input.locale, history: input.history.slice(-6) } }) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.status === 429 ? 'busy' : error.status === 401 ? 'session' : error.status === 403 || error.status === 404 ? 'forbidden' : error.status === 400 ? 'invalid' : 'unavailable' };
    return { error: 'unavailable' };
  }
}
