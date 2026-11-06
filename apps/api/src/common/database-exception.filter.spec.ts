import { Prisma } from '@prisma/client';
import { map } from './database-exception.filter';

describe('database error responses', () => {
  it('reports an unreachable database as 503, not a generic 500', () => {
    const error = new Prisma.PrismaClientInitializationError("Can't reach database server at `host:1`", '6.19.3', 'P1001');
    expect(map(error)).toEqual({ status: 503, message: 'The database is unreachable' });
  });

  it('never exposes the database message to callers', () => {
    const error = new Prisma.PrismaClientUnknownRequestError('secret table detail', { clientVersion: '6.19.3' });
    expect(map(error)).toEqual({ status: 500, message: 'Internal server error' });
  });

  describe('application status changes', () => {
    const raw = (code: string, message: string) =>
      new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${code}\`. Message: \`${message}\``, { code: 'P2010', clientVersion: '6.19.3' });

    it('reports a move the rules refuse as 422', () => {
      expect(map(raw('23514', 'Status cannot be changed from submitted to hired'))).toEqual({ status: 422, message: 'This change is not allowed' });
      expect(map(raw('23514', 'A withdrawn application cannot be changed')).status).toBe(422);
    });

    it('reports hiring before every assessment is reviewed as 422, by either route', () => {
      expect(map(raw('23514', 'Hiring is not allowed until every assessment is reviewed')).status).toBe(422);
      // A hiring outcome is refused by a trigger during an ordinary insert, without the raw-query wrapper.
      const viaOutcome = new Prisma.PrismaClientUnknownRequestError('ERROR: Hiring is not allowed until every assessment is reviewed', { clientVersion: '6.19.3' });
      expect(map(viaOutcome).status).toBe(422);
    });

    it("reports another organization's application, or a candidate's own, as not found", () => {
      expect(map(raw('P0002', 'Application not found'))).toEqual({ status: 404, message: 'Not found' });
    });

    it('reports a direct table write, which is no longer granted, as 403', () => {
      expect(map(raw('42501', 'permission denied for table applications')).status).toBe(403);
    });
  });
});
