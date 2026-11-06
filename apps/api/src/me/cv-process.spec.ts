import { PermanentJobError } from '../jobs-queue/errors';
import type { AiClient } from '../ai/ai.client';
import type { AuthUser, DbService } from '../db/db.service';
import { CvController, isOwnFileLink } from './cv.controller';

const USER: AuthUser = { id: 'user-1', email: 'user@example.com' };
const BASE = 'https://project.supabase.test';
const OWN = `${BASE}/storage/v1/object/sign/candidate-documents/user-1/cv.pdf?token=signed-secret`;

function setup() {
  const updates: unknown[] = [];
  const tx = {
    cv_analyses: {
      findFirst: jest.fn(async () => ({ id: 'analysis-1' })),
      updateMany: jest.fn(async (args: { data: unknown }) => {
        updates.push(args.data);
        return { count: 1 };
      }),
    },
    candidate_profiles: { findUnique: jest.fn(async () => ({ full_name: 'Fictional Person' })) },
  };
  const db = { asUser: (_: AuthUser, work: (t: unknown) => Promise<unknown>) => work(tx) } as unknown as DbService;
  const ai = { analyzeCv: jest.fn(async () => ({ status: 'failed', code: 'unreadable' })) } as unknown as AiClient;
  return { controller: new CvController(db, ai), updates, ai };
}

describe('CV analysis file link', () => {
  const env = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let fetched: jest.SpyInstance;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
    fetched = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env;
  });

  it.each([
    ['nothing at all', ''],
    ['not a URL', 'not a url'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a service on this machine', 'http://localhost:8000/health'],
    ['another host with the right path', 'https://evil.test/storage/v1/object/sign/candidate-documents/user-1/cv.pdf?token=x'],
    ['a host that starts like ours', `${BASE}.evil.test/storage/v1/object/sign/candidate-documents/user-1/cv.pdf?token=x`],
    ["another person's folder", `${BASE}/storage/v1/object/sign/candidate-documents/user-2/cv.pdf?token=x`],
    ['a path that climbs out of the folder', `${BASE}/storage/v1/object/sign/candidate-documents/user-1/../user-2/cv.pdf?token=x`],
    ['an encoded climb', `${BASE}/storage/v1/object/sign/candidate-documents/user-1/%2e%2e/user-2/cv.pdf?token=x`],
    ['an unsigned route', `${BASE}/storage/v1/object/candidate-documents/user-1/cv.pdf`],
  ])('never fetches %s: the candidate sees a failure, and the queue does not retry', async (_, link) => {
    const { controller, updates } = setup();
    await expect(controller.process(USER, 'analysis-1', link)).rejects.toThrow(PermanentJobError);
    expect(fetched).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'failed', failure_code: 'file_unavailable' });
  });

  it('accepts a signed link to the candidate\'s own file', () => {
    expect(isOwnFileLink(OWN, 'user-1')).toBe(true);
  });

  it.each([400, 403, 404])('treats a %i from Storage, as an expired link gets, as permanent', async (status) => {
    fetched.mockResolvedValue(new Response('{"error":"InvalidJWT"}', { status }));
    const { controller, updates } = setup();
    await expect(controller.process(USER, 'analysis-1', OWN)).rejects.toThrow(new PermanentJobError('file_unavailable'));
    expect(updates[0]).toMatchObject({ status: 'failed', failure_code: 'file_unavailable' });
  });

  it.each([429, 500, 503])('leaves a %i from Storage for the queue to retry, with the analysis still pending', async (status) => {
    fetched.mockResolvedValue(new Response('{}', { status }));
    const { controller, updates } = setup();
    const failure = await controller.process(USER, 'analysis-1', OWN).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PermanentJobError);
    expect(updates).toEqual([]);
  });

  it('retries an unreachable Storage, and its error holds no link', async () => {
    fetched.mockRejectedValue(new TypeError(`fetch failed for ${OWN}`));
    const { controller } = setup();
    const failure = (await controller.process(USER, 'analysis-1', OWN).catch((e: unknown) => e)) as Error;
    expect(failure).not.toBeInstanceOf(PermanentJobError);
    expect(failure.message).not.toMatch(/signed-secret|token=/);
  });

  it('does not follow a redirect, and passes only the file to the AI service', async () => {
    fetched.mockResolvedValue(new Response(Buffer.from('%PDF-1.4'), { status: 200 }));
    const { controller, ai } = setup();
    await controller.process(USER, 'analysis-1', OWN);
    expect(fetched.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(JSON.stringify((ai.analyzeCv as jest.Mock).mock.calls[0])).not.toMatch(/signed-secret|token=/);
  });
});
