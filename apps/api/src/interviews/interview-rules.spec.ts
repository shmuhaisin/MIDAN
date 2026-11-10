import { UnprocessableEntityException } from '@nestjs/common';
import { assertInterviewCandidateShortlisted, futureInterviewTime } from './interview-rules';

describe('interview scheduling rules', () => {
  it('allows scheduling only after an explicit shortlist decision', () => {
    expect(() => assertInterviewCandidateShortlisted('shortlisted')).not.toThrow();
    for (const status of ['submitted', 'under_review', 'evaluated', 'assessment_completed', 'rejected', 'hired', 'withdrawn']) {
      expect(() => assertInterviewCandidateShortlisted(status)).toThrow(UnprocessableEntityException);
    }
  });

  it('accepts a future timestamp with an explicit UTC offset', () => {
    expect(futureInterviewTime('2030-01-01T12:00:00+03:00', Date.parse('2029-12-31T00:00:00Z')).toISOString())
      .toBe('2030-01-01T09:00:00.000Z');
  });

  it('rejects invalid and past interview times', () => {
    expect(() => futureInterviewTime('not-a-date', 0)).toThrow(UnprocessableEntityException);
    expect(() => futureInterviewTime('2020-01-01T12:00:00Z', Date.parse('2021-01-01T00:00:00Z'))).toThrow(UnprocessableEntityException);
    expect(() => futureInterviewTime('2021-01-01T00:00:00Z', Date.parse('2021-01-01T00:00:00Z'))).toThrow(UnprocessableEntityException);
  });
});
