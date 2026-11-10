import { UnprocessableEntityException } from '@nestjs/common';

/** A calendar instant must be unambiguous and in the future before an interview is created or moved. */
export function futureInterviewTime(value: string, now = Date.now()): Date {
  const when = new Date(value);
  if (!Number.isFinite(when.getTime()) || when.getTime() <= now) {
    throw new UnprocessableEntityException('Choose a valid future interview time');
  }
  return when;
}

/** Keep the shortlist rule explicit at the API boundary as well as in the database trigger. */
export function assertInterviewCandidateShortlisted(status: string): void {
  if (status !== 'shortlisted') {
    throw new UnprocessableEntityException('Shortlist the candidate before scheduling an interview');
  }
}
