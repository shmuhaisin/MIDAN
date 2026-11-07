import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

type Mapped = { status: number; message: string };

type DatabaseError = Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError | Prisma.PrismaClientInitializationError;

export function map(error: DatabaseError): Mapped {
  if (error instanceof Prisma.PrismaClientInitializationError) return { status: 503, message: 'The database is unreachable' };
  const text = error.message;
  const code = 'code' in error ? error.code : undefined;
  if (code === 'P2028') return { status: 503, message: 'Temporarily unavailable' };
  if (code === 'P2002') return { status: 409, message: 'This already exists' };
  if (code === 'P2025') return { status: 404, message: 'Not found' };
  if (code === 'P2003') return { status: 400, message: 'A referenced record does not exist' };
  if (/P0002|No account with that email|not found/i.test(text)) return { status: 404, message: 'Not found' };
  if (/22023|Unknown action|Unknown resolution|not queued from here/i.test(text)) return { status: 400, message: 'Invalid request' };
  if (/row-level security|permission denied|42501|not available|is for an organization owner or admin/i.test(text)) return { status: 403, message: 'Not allowed' };
  if (/23514|check constraint|not open for|immutable|cannot be changed|not allowed until|before approv|already has a draft|starts from an approved one|recorded as generated/i.test(text)) {
    return { status: 422, message: 'This change is not allowed' };
  }
  return { status: 500, message: 'Internal server error' };
}

/** Turns database errors into API responses without leaking SQL or schema details. */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError, Prisma.PrismaClientInitializationError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(error: DatabaseError, host: ArgumentsHost) {
    const { status, message } = map(error);
    if (status >= 500) this.logger.error(error.message);
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message });
  }
}
