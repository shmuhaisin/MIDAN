import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

export type Provenance = { mode: 'demo' | 'live'; provider?: string; model_version: string; prompt_version: string };
export type GraphResult<T> = { status: string; payload: T; provenance: Provenance };

/** The only route to the private AI service. Its token never leaves the backend. */
@Injectable()
export class AiClient {
  private async post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${process.env.AI_SERVICE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN ?? '' },
        body: JSON.stringify(body),
        // A bounded wait where a person is waiting on the page; generation and evaluation keep the service's own limits.
        ...(timeoutMs && { signal: AbortSignal.timeout(timeoutMs) }),
      });
    } catch {
      throw new ServiceUnavailableException('The AI service is unavailable');
    }
    if (response.status === 409 || response.status === 422) throw new UnprocessableEntityException('The AI service refused this request');
    if (!response.ok) throw new ServiceUnavailableException('The AI service is unavailable');
    return response.json() as Promise<T>;
  }

  analyzeCv<T>(body: { file_base64: string; known_names: string[] }) {
    return this.post<T>('/cv/analyze', body);
  }

  /** The MIDAN Assessment Standard's check of a version as stored. Deterministic: no model is called. */
  evaluateQuality<T>(body: { job: unknown; stored: unknown }) {
    return this.post<T>('/quality/evaluate', body);
  }

  /** Requirement-to-evidence matching. Deterministic similarity, no model call: a proposal for people to review. */
  matchRequirements<T>(body: { requirements: unknown[]; evidence: unknown[] }) {
    return this.post<T>('/match/requirements', body, 20_000);
  }

  /** The assistant: answers only from the facts and links supplied here, which the API retrieved with the asker's permissions. */
  answerQuestion(body: { role: 'candidate' | 'employer'; locale: 'ar' | 'en'; question: string; facts: unknown[]; links: unknown[]; history: unknown[] }) {
    return this.post<{ answer: string; facts: { id: string; text: string }[]; links: { key: string; href: string; label: string }[]; mode: string; grounded: boolean; provenance: Record<string, unknown> }>('/assistant/answer', body, 45_000);
  }

  /** One draft task written again by the live model. The service answers 503 without the model: it never falls back to templates. */
  regenerateTask<T>(body: { job: unknown; task: unknown; other_titles: string[]; note?: string }) {
    return this.post<T>('/assessment/regenerate-task', body, 90_000);
  }

  /** Workbook skills for one job: ranked by meaning, chosen by the live model from that shortlist when it is available. */
  suggestSkills<T>(body: { job: unknown; catalog: unknown[] }) {
    // The first call for a sector embeds its catalog (about 25 s for 1,400 skills on a laptop CPU); later calls are fast.
    return this.post<T>('/skills/suggest', body, 180_000);
  }

  run<T>(graph: 'assessment-builder' | 'evaluation', body: unknown) {
    return this.post<GraphResult<T>>(`/graphs/${graph}/runs`, body);
  }

  resume<T>(graph: 'assessment-builder' | 'evaluation', threadId: string, value: unknown) {
    return this.post<Omit<GraphResult<T>, 'provenance'>>(`/graphs/${graph}/runs/${threadId}/resume`, { value });
  }
}
