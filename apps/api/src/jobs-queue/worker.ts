import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuthUser, DbService } from '../db/db.service';
import { CvController } from '../me/cv.controller';
import { PermanentJobError } from './errors';

type Job = { id: string; kind: string; acting_user_id: string; acting_email: string; subject_id: string | null; payload: Record<string, unknown>; attempts: number };


/**
 * Runs queued work from public.background_jobs. Any number of API processes can run it: claims use
 * FOR UPDATE SKIP LOCKED, and a job whose worker stops is reclaimed when its lease runs out.
 * Logs carry job ids, kinds and error classes only, never payloads or content.
 */
@Injectable()
export class BackgroundWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackgroundWorker.name);
  private readonly name = `api-${process.pid}-${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;

  constructor(private readonly db: DbService, private readonly cv: CvController) {}

  private readonly handlers: Record<string, (job: Job, user: AuthUser) => Promise<unknown>> = {
    cv_analysis: (job, user) => this.cv.process(user, job.subject_id as string, String(job.payload.file_url ?? '')),
  };

  onModuleInit() {
    if (process.env.BACKGROUND_WORKER === 'off') return;
    const every = Number(process.env.BACKGROUND_WORKER_POLL_MS ?? 1000);
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (let i = 0; i < 50 && this.busy; i++) await new Promise((r) => setTimeout(r, 100));
  }

  /** Claims and runs jobs until none are ready. Public so tests can drive it. */
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      for (let job = await this.claim(); job && !this.stopped; job = await this.claim()) await this.runOne(job);
    } catch (error) {
      this.logger.warn(`Queue unavailable: ${(error as Error).name}`);
    } finally {
      this.busy = false;
    }
  }

  private async claim(): Promise<Job | undefined> {
    const rows = await this.db.asWorker((tx) =>
      tx.$queryRaw<Job[]>`select * from private.claim_background_job(${this.name}, ${Object.keys(this.handlers)}::text[])`);
    return rows[0];
  }

  private async runOne(job: Job) {
    const user = { id: job.acting_user_id, email: job.acting_email };
    let ok = false;
    let result: unknown = null;
    let error: string | null = null;
    let retryable = true;
    try {
      result = (await this.handlers[job.kind](job, user)) ?? null;
      ok = true;
    } catch (e) {
      retryable = !(e instanceof PermanentJobError);
      error = e instanceof PermanentJobError ? e.message : (e as Error).name || 'Error';
    }
    const [settled] = await this.db.asWorker((tx) => tx.$queryRaw<{ status: string }[]>`
      select status from private.settle_background_job(${job.id}::uuid, ${this.name}, ${ok}, ${JSON.stringify(result)}::jsonb, ${error}, ${retryable})`);
    this.logger.log(`Job ${job.id} ${job.kind} attempt ${job.attempts}: ${settled?.status ?? 'superseded'}${error ? ` (${error})` : ''}`);
    if (settled?.status === 'failed' && job.kind === 'cv_analysis') await this.cv.markFailed(user, job.subject_id as string, error).catch(() => undefined);
  }
}
