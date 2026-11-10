import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiClient } from '../ai/ai.client';
import { applicantProfile } from '../common/applicant';
import { AuthUser, DbService } from '../db/db.service';
import { evidenceFrom, type AiMatch, type CvReview, type MatchItem } from './ats';

/** Waits for one background evaluation, which runs the configured matcher (the hybrid reranker included). */
const BACKGROUND_TIMEOUT_MS = Number(process.env.CV_MATCH_TIMEOUT_MS) || 300_000;
/** Background evaluations at once: the AI service runs them on the same CPU, so one at a time keeps it responsive. */
const CONCURRENCY = 1;
/** A stored fallback result is evaluated again with the full matcher after this long. */
const RETRY_FALLBACK_MS = 10 * 60_000;
/** A stage 3 review the model couldn't write (rate limit, quota, outage) is tried again after this long. */
const RETRY_REVIEW_MS = Number(process.env.CV_REVIEW_RETRY_MS) || 10 * 60_000;

export type StoredState =
  | { state: 'ready'; result: AiMatch; computed_at: Date }
  | { state: 'computing' }
  | { state: 'unavailable'; reason: string };

type Row = { fingerprint: string; result: AiMatch; computed_at: Date };

/**
 * MIDAN's CV match per application, computed once in the background and kept (application_cv_matches). Ranking and the
 * applicant page read it, so they never wait on the matcher: a stored result is used while its fingerprint (approved
 * requirements, the application's snapshot, the matcher) still holds; otherwise one background evaluation is scheduled and
 * the screen says "analysis in progress". A background evaluation that fails or times out is retried once in fast mode
 * (e5 alone), stored with that fallback stated in its provenance, so ATS keeps working when the reranker can't.
 * People's reviews are applied when it's read; the score formula is unchanged.
 */
@Injectable()
export class CvMatchStore {
  private readonly logger = new Logger(CvMatchStore.name);
  private readonly pending = new Map<string, { state: 'computing' } | { state: 'unavailable'; reason: string; at: number }>();
  private readonly queue: (() => Promise<void>)[] = [];
  private readonly reviewing = new Set<string>();
  private running = 0;

  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  static fingerprint(items: MatchItem[], snapshot: Prisma.JsonValue | null) {
    return createHash('sha256').update(JSON.stringify({ items, snapshot, matcher: process.env.EMBEDDING_PROVIDER ?? '' })).digest('hex');
  }

  static request(items: MatchItem[], snapshot: Prisma.JsonValue | null) {
    return {
      requirements: items.map((r) => ({ key: r.key, text: [r.text_ar, r.text_en].filter(Boolean).join(' / '), mandatory: r.mandatory, min_years: r.min_years, skill_id: r.skill_id })),
      evidence: evidenceFrom(applicantProfile(snapshot)),
    };
  }

  /**
   * The stored match for these applications, scheduling a background evaluation for each one that's missing or stale.
   * With `wait` (tests and scripts, never a screen), missing ones are evaluated first, one at a time, before answering.
   */
  async read(user: AuthUser, orgId: string, applications: { id: string; profile_snapshot: Prisma.JsonValue | null }[], items: MatchItem[], wait = false) {
    if (wait) {
      const first = await this.read(user, orgId, applications, items);
      for (const a of applications) if (first.get(a.id)?.state !== 'ready') await this.evaluate(user, orgId, a.id, items, a.profile_snapshot);
    }
    const ids = applications.map((a) => a.id);
    const rows = ids.length === 0 ? [] : await this.db.asUser(user, (tx) => tx.$queryRaw<(Row & { application_id: string })[]>`
      select application_id, fingerprint, result, computed_at from public.application_cv_matches where application_id = any(${ids}::uuid[])`);
    const stored = new Map(rows.map((r) => [r.application_id, r]));
    const out = new Map<string, StoredState>();
    for (const a of applications) {
      const fingerprint = CvMatchStore.fingerprint(items, a.profile_snapshot);
      const row = stored.get(a.id);
      if (row && row.fingerprint === fingerprint) {
        out.set(a.id, { state: 'ready', result: row.result, computed_at: row.computed_at });
        // A result the full matcher couldn't produce (stored with a fallback) is evaluated again in the background after
        // a while; the stored e5 result stays on screen meanwhile.
        const stale = row.result.provenance?.fallback && Date.now() - new Date(row.computed_at).getTime() > RETRY_FALLBACK_MS;
        if (stale && !this.pending.has(a.id)) this.schedule(user, orgId, a.id, items, a.profile_snapshot, fingerprint);
        // Stage 3: written once the match is stored; one the model couldn't write is tried again after a while.
        const review = row.result.review;
        const reviewDue = !review || (review.state === 'unavailable' && Date.now() - new Date(review.at).getTime() > RETRY_REVIEW_MS);
        if (!stale && reviewDue && !this.reviewing.has(a.id)) this.scheduleReview(user, orgId, a.id, items, a.profile_snapshot, row.result, fingerprint);
        continue;
      }
      const p = this.pending.get(a.id);
      // A failed evaluation is shown as unavailable, and tried again after a minute.
      if (p?.state === 'unavailable' && Date.now() - p.at < 60_000) { out.set(a.id, { state: 'unavailable', reason: p.reason }); continue; }
      if (p?.state !== 'computing') this.schedule(user, orgId, a.id, items, a.profile_snapshot, fingerprint);
      out.set(a.id, { state: 'computing' });
    }
    return out;
  }

  /** Evaluate now and wait (for tests and scripts that need the stored result). */
  async evaluate(user: AuthUser, orgId: string, applicationId: string, items: MatchItem[], snapshot: Prisma.JsonValue | null) {
    await this.compute(user, orgId, applicationId, items, snapshot, CvMatchStore.fingerprint(items, snapshot));
  }

  private schedule(user: AuthUser, orgId: string, id: string, items: MatchItem[], snapshot: Prisma.JsonValue | null, fingerprint: string) {
    this.pending.set(id, { state: 'computing' });
    this.queue.push(() => this.compute(user, orgId, id, items, snapshot, fingerprint));
    this.drain();
  }

  private scheduleReview(user: AuthUser, orgId: string, id: string, items: MatchItem[], snapshot: Prisma.JsonValue | null, result: AiMatch, fingerprint: string) {
    this.reviewing.add(id);
    this.queue.push(async () => {
      try {
        const review = await this.review(items, snapshot, result);
        await this.db.asUser(user, (tx) => tx.$executeRaw`
          update public.application_cv_matches set result = jsonb_set(result, '{review}', ${JSON.stringify(review)}::jsonb)
          where application_id = ${id}::uuid and fingerprint = ${fingerprint}`);
      } catch (error) {
        this.logger.warn(`CV review for ${id} not stored: ${error instanceof Error ? error.message : 'unknown'}`);
      } finally {
        this.reviewing.delete(id);
      }
    });
    this.drain();
  }

  /** ATS stage 3 on a stored match: the model's reading per requirement, or why it couldn't be written. Never a score. */
  private async review(items: MatchItem[], snapshot: Prisma.JsonValue | null, result: AiMatch): Promise<CvReview> {
    const proposals = new Map(result.matches.map((m) => [m.key, m]));
    const requirements = items.filter((r) => proposals.has(r.key)).map((r) => ({
      key: r.key, text: [r.text_ar, r.text_en].filter(Boolean).join(' / '), mandatory: r.mandatory, min_years: r.min_years,
      status: proposals.get(r.key)!.status, evidence_id: proposals.get(r.key)!.evidence_id,
    }));
    const at = new Date().toISOString();
    if (requirements.length === 0) return { state: 'unavailable', reason: 'no_requirements', at };
    try {
      const out = await this.ai.reviewCv<Omit<Extract<CvReview, { state: 'ready' }>, 'state' | 'at'>>({ requirements, evidence: evidenceFrom(applicantProfile(snapshot)) });
      return { state: 'ready', ...out, at };
    } catch (error) {
      const reason = (error as { response?: { reason?: string } })?.response?.reason ?? (error instanceof Error ? error.message : 'unavailable');
      return { state: 'unavailable', reason, at };
    }
  }

  private drain() {
    while (this.running < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!;
      this.running += 1;
      job().finally(() => { this.running -= 1; this.drain(); });
    }
  }

  private async compute(user: AuthUser, orgId: string, id: string, items: MatchItem[], snapshot: Prisma.JsonValue | null, fingerprint: string) {
    const body = CvMatchStore.request(items, snapshot);
    let result: AiMatch | null = null;
    try {
      result = await this.ai.matchRequirements<AiMatch>(body, BACKGROUND_TIMEOUT_MS);
    } catch (error) {
      // The full matcher didn't answer in time or failed: e5 alone, with the reason kept beside the result.
      this.logger.warn(`CV match for ${id}: full matcher failed (${error instanceof Error ? error.message : 'unknown'}); trying e5 alone`);
      try {
        const fast = await this.ai.matchRequirements<AiMatch>({ ...body, mode: 'fast' }, 60_000);
        result = { ...fast, provenance: { ...fast.provenance, fallback: `full matcher unavailable (${error instanceof Error ? error.message : 'unknown'}); e5 used instead` } };
      } catch (second) {
        this.pending.set(id, { state: 'unavailable', reason: second instanceof Error ? second.message : 'unavailable', at: Date.now() });
        return;
      }
    }
    try {
      await this.db.asUser(user, (tx) => tx.$executeRaw`
        insert into public.application_cv_matches (application_id, org_id, fingerprint, result, provenance)
        values (${id}::uuid, ${orgId}::uuid, ${fingerprint}, ${JSON.stringify(result)}::jsonb, ${JSON.stringify(result!.provenance ?? { provider: 'unknown' })}::jsonb)
        on conflict (application_id) do update set fingerprint = excluded.fingerprint, result = excluded.result, provenance = excluded.provenance`);
      this.pending.delete(id);
    } catch (error) {
      this.pending.set(id, { state: 'unavailable', reason: error instanceof Error ? error.message : 'unavailable', at: Date.now() });
    }
  }
}
