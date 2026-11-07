import { guidanceFor } from './guidance';

describe("the assessor guide's guidance for a criterion", () => {
  const guide = {
    standard_version: 'MAS-1.0',
    criteria_guidance: {
      '1:C1': { levels_en: { '0': 'Nothing', '4': 'Cause with figures' }, levels_ar: { '4': 'السبب مع الأرقام' }, evidence_en: 'Quotes a figure' },
      '2:C1': { evidence_ar: 'يذكر مصدرًا', levels_en: { '1': 7 } },
    },
  };

  it('finds the guidance by task position and criterion code', () => {
    expect(guidanceFor(guide, 1, 'C1')).toEqual({ levels_en: { '0': 'Nothing', '4': 'Cause with figures' }, levels_ar: { '4': 'السبب مع الأرقام' }, evidence_en: 'Quotes a figure' });
    // Same code on another task is another criterion; malformed levels are dropped, not guessed.
    expect(guidanceFor(guide, 2, 'C1')).toEqual({ evidence_ar: 'يذكر مصدرًا' });
  });

  it('gives nothing without a guide, or for a criterion the guide does not cover', () => {
    expect(guidanceFor(null, 1, 'C1')).toEqual({});
    expect(guidanceFor({}, 1, 'C1')).toEqual({});
    expect(guidanceFor(guide, 3, 'C2')).toEqual({});
  });
});
