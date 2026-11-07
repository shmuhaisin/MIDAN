import { practiceChecklist, practiceTask } from './practice';

describe('practice tasks', () => {
  it('says what a task is, and never calls it employment', () => {
    for (const kind of ['simulated_task', 'portfolio_project'] as const) {
      const task = practiceTask(kind, 'تحليل البيانات', 'محلل بيانات');
      expect(task.title_ar).toContain('تحليل البيانات');
      expect(task.brief_en).toMatch(kind === 'simulated_task' ? /practice only: not a job, not work experience/ : /your own work, not work experience/);
      expect(task.brief_ar).toMatch(/ليست وظيفة ولا خبرة عمل|لا خبرة عمل لدى جهة/);
      expect(task.instructions.length).toBeGreaterThan(0);
      expect(task.deliverables.length).toBeGreaterThan(0);
      expect(JSON.stringify(task)).not.toMatch(/score|hired|employer reviewed/i);
    }
  });

  it('checks the shape of a submission only, and labels nothing as a grade', () => {
    const body = ['الموقف: تقرير شهري متأخر يحتاج إلى تحليل البيانات.', 'الخطوات: جمع البيانات ثم تنظيفها ثم مقارنتها.', 'التحقق: مقارنة النتائج بالشهر السابق.'].join('\n\n');
    const short = practiceChecklist('simulated_task', 'تحليل البيانات', body, null, 3);
    expect(short).toEqual([
      { code: 'enough_detail', met: false },
      { code: 'each_deliverable', met: true },
      { code: 'names_skill', met: true },
    ]);
    const long = practiceChecklist('portfolio_project', 'تحليل البيانات', `${body}\n\n${'كلمة '.repeat(130)}`, null, 4);
    expect(long.find((c) => c.code === 'enough_detail')?.met).toBe(true);
    expect(long.find((c) => c.code === 'has_link')?.met).toBe(false);
  });
});
