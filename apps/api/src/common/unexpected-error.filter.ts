import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * Logs an unexpected error by its class only. Nest's default logs the whole object, and an error from fetch can carry the
 * raw request in its cause, with the caller's token in it.
 */
@Catch()
export class UnexpectedErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(UnexpectedErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    // Errors with a status of their own, such as a body too large for the parser, are expected and hold no such detail.
    if (error instanceof HttpException || typeof (error as { statusCode?: unknown })?.statusCode === 'number') return super.catch(error, host);
    this.logger.error(`Unhandled ${(error as Error)?.name ?? 'error'}`);
    host.switchToHttp().getResponse<Response>().status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
