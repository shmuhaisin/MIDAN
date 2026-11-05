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
});
