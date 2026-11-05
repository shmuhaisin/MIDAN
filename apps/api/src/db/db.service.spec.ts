import { Prisma } from '@prisma/client';
import { DbService } from './db.service';

const expired = () => new Prisma.PrismaClientKnownRequestError('Transaction API error', { code: 'P2028', clientVersion: 'test' });

describe('DbService.withRetry', () => {
  const db = new DbService();

  it('runs an expired transaction once more', async () => {
    const run = jest.fn().mockRejectedValueOnce(expired()).mockResolvedValueOnce('done');
    await expect(db.withRetry(run)).resolves.toBe('done');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry', async () => {
    const run = jest.fn().mockRejectedValue(expired());
    await expect(db.withRetry(run)).rejects.toThrow('Transaction API error');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never retries other failures, such as a refused write', async () => {
    const refused = new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' });
    const run = jest.fn().mockRejectedValue(refused);
    await expect(db.withRetry(run)).rejects.toBe(refused);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
