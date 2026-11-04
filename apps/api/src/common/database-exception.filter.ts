import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

type Mapped = { status: number; message: string };

function map(error: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError): Mapped {
  const text = error.message;
  const code = 'code' in error ? error.code : undefined;
  if (code === 'P2002') return { status: 409, message: 'This already exists' };
  if (code === 'P2025') return { status: 404, message: 'Not found' };
  if (code === 'P2003') return { status: 400, message: 'A referenced record does not exist' };
  if (/row-level security|permission denied|42501|not available/i.test(text)) return { status: 403, message: 'Not allowed' };
  if (/23514|check constraint|not open for|immutable|cannot be changed/i.test(text)) return { status: 422, message: 'This change is not allowed' };
  return { status: 500, message: 'Internal server error' };
}

/** Turns database errors into API responses without leaking SQL or schema details. */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(error: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError, host: ArgumentsHost) {
    const { status, message } = map(error);
    if (status === 500) this.logger.error(error.message);
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message });
  }
}
