import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

/**
 * A POST with no header timeout, for calls that wait on the model for minutes (generation written in parts, each waiting for
 * the provider's per-minute limit). Node's fetch gives up after 300 s without response headers, which isn't enough. The
 * service's own limits still apply, and AI_LONG_CALL_MS (default 20 minutes) bounds the wait.
 */
function postLong(url: string, headers: Record<string, string>, body: string): Promise<Response> {
  const target = new URL(url);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(target, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() }, timeout: Number(process.env.AI_LONG_CALL_MS) || 20 * 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

export type Provenance = { mode: 'demo' | 'live'; provider?: string; model_version: string; prompt_version: string };
export type GraphResult<T> = { status: string; payload: T; provenance: Provenance };

/** The only route to the private AI service. Its token never leaves the backend. */
@Injectable()
export class AiClient {
  private async post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    let response: Response;
    const headers = { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN ?? '' };
    try {
      response = timeoutMs
        // A bounded wait where a person is waiting on the page.
        ? await fetch(`${process.env.AI_SERVICE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
        // Generation and evaluation keep the service's own limits, which can be longer than fetch's 300 s for headers.
        : await postLong(`${process.env.AI_SERVICE_URL}${path}`, headers, JSON.stringify(body));
    } catch {
      throw new ServiceUnavailableException('The AI service is unavailable');
    }
    if (response.status === 409 || response.status === 422) throw new UnprocessableEntityException('The AI service refused this request');
    if (response.status === 503) {
      // The service says why (ai_unavailable:quota_exhausted, ...): passed on, so the page can say it plainly.
      const detail = ((await response.json().catch(() => ({}))) as { detail?: string }).detail ?? '';
      const reason = detail.startsWith('ai_unavailable:') ? detail.slice('ai_unavailable:'.length) : 'unavailable';
      throw new ServiceUnavailableException({ message: `MIDAN's model is not available (${reason})`, reason, error: 'ai_unavailable' });
    }
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
  matchRequirements<T>(body: { requirements: unknown[]; evidence: unknown[]; mode?: 'full' | 'fast' }, timeoutMs = 20_000) {
    return this.post<T>('/match/requirements', body, timeoutMs);
  }

  /**
   * ATS stage 3: the live model's evidence-based reading of each requirement, beside the matcher's status and score, which
   * it never changes. 503 with the reason without a live model.
   */
  reviewCv<T>(body: { title_en?: string; title_ar?: string; requirements: unknown[]; evidence: unknown[] }, timeoutMs = 150_000) {
    return this.post<T>('/match/review', body, timeoutMs);
  }

  /** A job's requirements suggested by the live model, for the employer to approve. 503 without the model. */
  suggestRequirements<T>(body: unknown) {
    return this.post<T>('/requirements/suggest', body, 240_000);
  }

  /** Career readiness, step 1: a target role's requirements and practical questions. Live model only (503 otherwise). */
  careerPlan<T>(body: { target_title: string; locale: 'ar' | 'en'; profile: unknown[] }) {
    return this.post<T>('/career/readiness/plan', body, 240_000);
  }

  /** Career readiness, step 2: answers scored, readiness and a roadmap, recommending only the catalog entries sent. */
  careerEvaluate<T>(body: { target_title: string; locale: string; requirements: unknown[]; questions: unknown[]; answers: unknown[]; catalog: unknown[] }) {
    return this.post<T>('/career/readiness/evaluate', body, 240_000);
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

  /**
   * A job's bilingual fields translated by the live model, for the employer to review. Without a model the service answers
   * 503 with the reason (ai_unavailable:<kind>); that reason is passed on, never replaced by invented text.
   */
  async translate(body: { source: 'ar' | 'en'; target: 'ar' | 'en'; fields: { key: string; text: string }[] }) {
    let response: Response;
    try {
      response = await fetch(`${process.env.AI_SERVICE_URL}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN ?? '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      return { ok: false as const, reason: 'unavailable' };
    }
    if (response.status === 503) {
      const detail = ((await response.json().catch(() => ({}))) as { detail?: string }).detail ?? '';
      return { ok: false as const, reason: detail.startsWith('ai_unavailable:') ? detail.slice('ai_unavailable:'.length) : 'unavailable' };
    }
    if (response.status === 422) throw new UnprocessableEntityException('The AI service refused this request');
    if (!response.ok) return { ok: false as const, reason: 'unavailable' };
    return { ok: true as const, ...((await response.json()) as { translations: { key: string; text: string }[]; provenance: Provenance }) };
  }

  /**
   * Interview questions or the evaluation form for one candidate, written by the live model from the facts given. Like
   * translation, a missing model is a stated reason (`ok: false`), never placeholder content.
   */
  async interview<T>(kind: 'questions' | 'evaluation-form' | 'development-report', body: unknown) {
    let response: Response;
    try {
      response = await fetch(`${process.env.AI_SERVICE_URL}/interview/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN ?? '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return { ok: false as const, reason: 'unavailable' };
    }
    if (response.status === 503) {
      const detail = ((await response.json().catch(() => ({}))) as { detail?: string }).detail ?? '';
      return { ok: false as const, reason: detail.startsWith('ai_unavailable:') ? detail.slice('ai_unavailable:'.length) : 'unavailable' };
    }
    if (response.status === 422) throw new UnprocessableEntityException('The AI service refused this request');
    if (!response.ok) return { ok: false as const, reason: 'unavailable' };
    return { ok: true as const, ...((await response.json()) as T & { provenance: Provenance }) };
  }

  run<T>(graph: 'assessment-builder' | 'evaluation', body: unknown) {
    return this.post<GraphResult<T>>(`/graphs/${graph}/runs`, body);
  }

  resume<T>(graph: 'assessment-builder' | 'evaluation', threadId: string, value: unknown) {
    return this.post<Omit<GraphResult<T>, 'provenance'>>(`/graphs/${graph}/runs/${threadId}/resume`, { value });
  }
}
