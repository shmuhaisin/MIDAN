// Evidence lines for requirement matching: each responsibility of a position is its own line, so the sentence that shows
// a requirement isn't diluted by the rest of the position; the position's years are counted once. Fictional data.
import { evidenceFrom } from './match.controller';

describe('evidenceFrom', () => {
  const profile = {
    experience: [
      { title: 'Credit Analyst', organization: 'Fictional Finance House', start_year: 2017, end_year: 2019,
        description: 'Analysed SME loan applications.\nWrote risk memos for the credit committee.\nx' },
      { title: 'Intern', organization: 'Fictional Bank', start_year: 2016, end_year: 2017, description: null },
    ],
  };

  it('gives the position, then one line per responsibility, and the years only once', () => {
    const lines = evidenceFrom(profile as never).filter((l) => l.source === 'experience');
    expect(lines.map((l) => [l.id, l.text, l.years])).toEqual([
      ['experience:0', 'Credit Analyst — Fictional Finance House', 2],
      ['experience:0:1', 'Analysed SME loan applications.', undefined],
      ['experience:0:2', 'Wrote risk memos for the credit committee.', undefined],
      ['experience:1', 'Intern — Fictional Bank', 1],
    ]);
  });
});
