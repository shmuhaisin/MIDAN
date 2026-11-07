import { Prisma } from '@prisma/client';
import { contextFor, qualitySummary, storedFromRows, type QualityReport } from './assessment-quality';

describe('the MIDAN Assessment Standard on the API side', () => {
  it("sends the job's sector and level, and the company type chosen for this generation or the organization's", () => {
    const job = { sector: 'digital', experience_level: 'mid' };
    expect(contextFor(job, 'startup')).toEqual({ company_type: 'startup', sector: 'digital', experience_level: 'mid' });
    expect(contextFor(job, 'startup', 'large_enterprise').company_type).toBe('large_enterprise');
    expect(contextFor({ sector: null, experience_level: null }, null)).toEqual({ company_type: null, sector: null, experience_level: null });
  });

  it('reads a stored version in the shape the quality check expects, with numbers, mappings and the guide', () => {
    const stored = storedFromRows({ candidate_brief: { scenario_en: 'x' } }, [{
      position: 1, task_type: 'written_case_study', title_ar: 'أ', title_en: 'A', instructions_ar: 'ب', instructions_en: 'B',
      weight: new Prisma.Decimal(60), config: { deliverable_ids: ['report'] }, reference_skill_ids: ['k1'],
      rubric_criteria: [{ code: 'C1', description_ar: 'د', description_en: 'D', max_score: new Prisma.Decimal(4), weight: new Prisma.Decimal(60), answer_key: null }],
      task_requirement_mappings: [{ requirement_id: 'r1' }],
      task_skill_mappings: [{ skill_id: 's1' }, { skill_id: 's1' }],
    }], { assessor_guide: {} });
    expect(stored.tasks[0]).toMatchObject({ weight: 60, requirement_ids: ['r1'], skill_ids: ['s1'], reference_skill_ids: ['k1'] });
    expect(stored.tasks[0].criteria[0]).toEqual({ code: 'C1', description_ar: 'د', description_en: 'D', max_score: 4, weight: 60, answer_key: null });
    expect(stored.guide).toEqual({ assessor_guide: {} });
  });

  it('summarizes a report without its findings', () => {
    const report = {
      standard_version: 'MAS-1.0', evaluator_version: 'quality-v1', standardized: true, verdict: 'blocked', overall_score: 61, dimensions: {},
      errors: [{ code: 'rubric_total_not_100', severity: 'error', message: 'm', where: 'rubric' }], warnings: [], required_revisions: ['Fix: m (rubric)'],
    } satisfies QualityReport;
    expect(qualitySummary(report)).toEqual({ verdict: 'blocked', standardized: true, overall_score: 61, standard_version: 'MAS-1.0', errors: 1, warnings: 0, required_revisions: ['Fix: m (rubric)'] });
  });
});
