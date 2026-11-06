import { Logger } from '@nestjs/common';
import type { DbService } from '../db/db.service';
import type { CvController } from '../me/cv.controller';
import { PermanentJobError } from './errors';
import { BackgroundWorker } from './worker';

const LINK = 'https://storage.test/storage/v1/object/sign/candidate-documents/user/cv.pdf?token=signed-secret';

/** A queue holding one CV job, with a database stand-in that records what the worker asks it. */
function setup(process: () => Promise<unknown>) {
  const job = { id: 'job-1', kind: 'cv_analysis', acting_user_id: 'user-1', acting_email: 'user@example.com', subject_id: 'analysis-1', payload: { file_url: LINK }, attempts: 1 };
  const queue = [job];
  const settled: unknown[][] = [];
  const db = {
    asWorker: (work: (tx: unknown) => Promise<unknown>) => work({
      $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => {
        if (sql.join('').includes('claim_background_job')) return Promise.resolve(queue.splice(0, 1));
        settled.push(values);
        return Promise.resolve([{ status: values[2] ? 'succeeded' : 'failed' }]);
      },
    }),
  } as unknown as DbService;
  const cv = { process: jest.fn(process), markFailed: jest.fn(async () => undefined) } as unknown as CvController;
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
  }
  return { worker: new BackgroundWorker(db, cv), cv, settled, lines };
}

describe('background worker', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes the file link to the work, and logs only the job, its kind and the outcome', async () => {
    const { worker, cv, settled, lines } = setup(async () => ({ status: 'ok' }));
    await worker.tick();
    expect(cv.process).toHaveBeenCalledWith({ id: 'user-1', email: 'user@example.com' }, 'analysis-1', LINK);
    expect(settled).toHaveLength(1);
    expect(lines.join('\n')).toContain('job-1 cv_analysis');
    expect(lines.join('\n')).not.toMatch(/storage\.test|signed-secret|token=/);
  });

  it('never logs or stores the link, even when a failure message carries it', async () => {
    const { worker, settled, lines } = setup(async () => {
      throw new TypeError(`fetch failed for ${LINK}`);
    });
    await worker.tick();
    // The error class is kept, the message (which holds the link) is not.
    expect(lines.join('\n')).toContain('TypeError');
    expect(lines.join('\n')).not.toMatch(/storage\.test|signed-secret|token=/);
    expect(JSON.stringify(settled)).not.toMatch(/storage\.test|signed-secret/);
  });

  it("keeps a permanent failure's short code, which never holds content", async () => {
    const { worker, cv, settled, lines } = setup(async () => {
      throw new PermanentJobError('file_unavailable');
    });
    await worker.tick();
    expect(lines.join('\n')).toContain('file_unavailable');
    expect(JSON.stringify(settled)).not.toMatch(/storage\.test|signed-secret/);
    expect(cv.markFailed).toHaveBeenCalledWith(expect.anything(), 'analysis-1', 'file_unavailable');
  });
});
