import { cvScore, interviewSummary, rankBy } from './ranking';

const item = (key: string, mandatory = true) => ({ key, kind: 'skill', text_ar: key, text_en: key, mandatory, min_years: null, skill_id: null });

describe('cvScore', () => {
  it('applies the matching rule: mandatory counts twice, partial is half, needs-review is left out', () => {
    const items = [item('a'), item('b'), item('c', false), item('d')];
    const r = cvScore(items, [{ key: 'a', status: 'matched' }, { key: 'b', status: 'partial' }, { key: 'c', status: 'missing' }, { key: 'd', status: 'needs_review' }], new Map());
    // (2*1 + 2*0.5 + 1*0) / (2 + 2 + 1) = 3/5
    expect(r.score).toBe(60);
    expect(r.counts).toEqual({ matched: 1, partial: 1, missing: 1, needs_review: 1 });
    expect(r.strengths.map((s) => s.key)).toEqual(['a']);
    expect(r.gaps).toEqual([]); // c is missing but optional
  });

  it("uses a person's review over MIDAN's proposal", () => {
    const r = cvScore([item('a')], [{ key: 'a', status: 'missing' }], new Map([['a', 'matched' as const]]));
    expect(r.score).toBe(100);
    expect(r.reviewed).toBe(1);
  });

  it('has no score when every requirement needs review', () => {
    expect(cvScore([item('a')], [{ key: 'a', status: 'needs_review' }], new Map()).score).toBeNull();
  });
});

describe('interviewSummary', () => {
  it('averages submitted ratings and counts recommendations, without a percentage', () => {
    const s = interviewSummary([{ status: 'scheduled', scheduled_at: new Date() }], [
      { recommendation: 'yes', competencies: [{ label: 'x', rating: 4 }, { label: 'y', rating: 3 }] },
      { recommendation: 'yes', competencies: [{ label: 'x', rating: 2 }] },
    ]);
    expect(s).toMatchObject({ state: 'scored', forms: 2, average_rating: 3, recommendations: { yes: 2 } });
  });
});

describe('rankBy', () => {
  const row = (id: string, cv: number | null, day: number) => ({
    application_id: id, applied_at: new Date(2026, 10, day), cv: cv === null ? { status: 'unavailable' } : { status: 'scored', score: cv },
    assessment_score: null, interview: { average_rating: null },
  });

  it('ranks everyone by the chosen stage, shares ranks on ties, and keeps pending applicants unranked', () => {
    const out = rankBy([row('a', 50, 1), row('b', 80, 2), row('c', null, 3), row('d', 50, 4), row('e', 90, 5)], 'cv');
    expect(out.map((r) => [r.application_id, r.rank])).toEqual([['e', 1], ['b', 2], ['a', 3], ['d', 3], ['c', null]]);
  });

  it('gives the same order for the same data, whatever order it arrives in, even with equal scores and times', () => {
    const rows = [row('m', 70, 1), row('k', 70, 1), row('z', null, 1), row('a', null, 1), row('q', 70, 1)];
    const once = rankBy(rows, 'cv').map((r) => r.application_id);
    const reversed = rankBy([...rows].reverse(), 'cv').map((r) => r.application_id);
    expect(once).toEqual(['k', 'm', 'q', 'a', 'z']);
    expect(reversed).toEqual(once);
    expect(rankBy(rows, 'cv').filter((r) => r.rank !== null).every((r) => r.rank === 1)).toBe(true);
  });

  it('never treats a missing result as zero', () => {
    const out = rankBy([row('low', 0, 1), row('none', null, 2)], 'cv');
    expect(out.map((r) => [r.application_id, r.rank])).toEqual([['low', 1], ['none', null]]);
  });

  it('never drops an applicant', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`x${i}`, i % 3 ? i : null, i + 1));
    expect(rankBy(rows, 'cv')).toHaveLength(25);
    expect(rankBy(rows, 'assessment').every((r) => r.rank === null)).toBe(true);
  });
});
