import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow } from '@/components/brand';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Criterion = { task_title_ar: string; task_title_en: string; code: string; description_ar: string; description_en: string; max_score: string; score: string | null; explanation: string | null; reviewed: boolean };
type Report = {
  criteria: Criterion[];
  overall_score: string; ai_mode: string | null;
  assessment_attempts: { assessment_versions: { assessments: { title_ar: string; title_en: string } }; applications: { jobs: { title_ar: string; title_en: string; organizations: { name_ar: string; name_en: string } } } };
  reference_skill_scores?: { score_pct: string; reference_skills: { id: string; name_ar: string; description_ar: string | null } }[];
  skill_scores: {
    level: number;
    skills: { id: string; name_ar: string; name_en: string; skill_levels: { level: number; descriptor_ar: string; descriptor_en: string }[] };
  }[];
};

export default async function Page({ params }: { params: Promise<{ locale: string; attemptId: string }> }) {
  const { locale, attemptId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  if (!/^[0-9a-f-]{36}$/.test(attemptId)) notFound();
  const report = await apiForPage<Report>(`/attempts/${attemptId}/report`);
  if (!report) notFound();
  const t = await getTranslations({ locale, namespace: 'report' });
  const job = report.assessment_attempts.applications.jobs;
  const assessment = report.assessment_attempts.assessment_versions.assessments;
  const describe = (s: Report['skill_scores'][number], level: number) => {
    const row = s.skills.skill_levels.find((l) => l.level === level);
    return row ? pick(locale, row.descriptor_ar, row.descriptor_en) : '';
  };
  const strengths = report.skill_scores.filter((s) => s.level >= 3);
  const improve = report.skill_scores.filter((s) => s.level < 3);

  return (
    <article className="container-page max-w-5xl py-8 lg:py-10">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground"><Arrow className="rotate-180" />{t('back')}</Link>
      <div className="mt-6 grid items-end gap-6 sm:grid-cols-[1fr_auto]">
        <div>
          <Eyebrow className="text-muted">
            {t('eyebrow')} · {pick(locale, job.title_ar, job.title_en)}
            {pick(locale, assessment.title_ar, assessment.title_en) !== pick(locale, job.title_ar, job.title_en) && ` · ${pick(locale, assessment.title_ar, assessment.title_en)}`}
          </Eyebrow>
          <h1 className="display-lg mt-3">{t('title')}</h1>
          <p className="mt-3 text-muted">{t('reviewedNote', { org: pick(locale, job.organizations.name_ar, job.organizations.name_en) })}</p>
          {report.ai_mode === 'demo' && <p className="mt-2 callout text-sm font-medium">{t('demoNote')}</p>}
        </div>
        <div className="on-deep deep-grain rounded-[var(--radius-panel)] bg-deep p-6 text-deep-foreground">
          <p className="text-sm text-deep-muted">{t('overall')}</p>
          <p className="kpi-value mt-1 text-5xl text-brand-gold">{number(locale, Number(report.overall_score))}</p>
          <p className="mt-1 max-w-44 text-xs text-deep-muted">{t('overallHint')}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="section-title">{t('skills')}</h2>
        <ul className="mt-4 border-t border-border">
          {report.skill_scores.map((s) => (
            <li key={s.skills.id} className="grid items-center gap-3 border-b border-border py-4 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="font-semibold">{pick(locale, s.skills.name_ar, s.skills.name_en)} · {`L${s.level}`}</p>
                <p className="mt-1 text-muted">{describe(s, s.level)}</p>
              </div>
              <span aria-hidden className="flex items-end gap-1">
                {[0, 1, 2, 3, 4].map((l) => <span key={l} style={{ height: `${10 + l * 7}px` }} className={l <= s.level ? (l === s.level ? 'w-4 rounded-t-[2px] bg-gold' : 'w-4 rounded-t-[2px] bg-primary') : 'w-4 rounded-t-[2px] bg-surface-2'} />)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(report.reference_skill_scores ?? []).length > 0 && (
        <section className="mt-8" aria-labelledby="workbook-skills">
          <h2 id="workbook-skills" className="section-title">{t('workbookSkills')}</h2>
          <p className="mt-1 text-sm text-muted">{t('workbookSkillsNote')}</p>
          <ul className="mt-4 border-t border-border">
            {report.reference_skill_scores!.map((s) => (
              <li key={s.reference_skills.id} className="grid items-center gap-3 border-b border-border py-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-semibold">{s.reference_skills.name_ar}</p>
                  {s.reference_skills.description_ar && <p className="mt-1 text-sm text-muted">{s.reference_skills.description_ar}</p>}
                </div>
                <span className="tabular-nums font-semibold">{number(locale, Number(s.score_pct))}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.criteria.length > 0 && (
        <section className="mt-8" aria-labelledby="criteria">
          <h2 id="criteria" className="section-title">{t('criteria')}</h2>
          <p className="mt-1 text-sm text-muted">{t('criteriaNote')}</p>
          <ul className="mt-4 border-t border-border">
            {report.criteria.map((c) => (
              <li key={`${c.task_title_en}-${c.code}`} className="grid gap-2 border-b border-border py-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="text-sm text-muted">{pick(locale, c.task_title_ar, c.task_title_en)}</p>
                  <p className="font-semibold">{pick(locale, c.description_ar, c.description_en)}</p>
                  {c.explanation && <p className="mt-1 text-muted"><bdi>{c.explanation}</bdi></p>}
                </div>
                <p className="subsection-title">{c.score == null ? '—' : number(locale, Number(c.score))} <span className="text-sm font-normal text-muted">/ {number(locale, Number(c.max_score))}</span></p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="section-title">{t('strengths')}</h2>
          {strengths.length === 0 ? <p className="mt-3 text-muted">{t('noStrengths')}</p> : (
            <ul className="mt-3 space-y-2">{strengths.map((s) => <li key={s.skills.id} className="font-medium">{pick(locale, s.skills.name_ar, s.skills.name_en)}</li>)}</ul>
          )}
        </section>
        <section>
          <h2 className="section-title">{t('improve')}</h2>
          {improve.length === 0 ? <p className="mt-3 text-muted">{t('noImprove')}</p> : (
            <ul className="mt-3 space-y-4">
              {improve.map((s) => (
                <li key={s.skills.id}>
                  <p className="font-medium">{pick(locale, s.skills.name_ar, s.skills.name_en)}</p>
                  <p className="mt-1 text-sm text-muted">{t('toNext', { level: `L${s.level + 1}` })} {describe(s, s.level + 1)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  );
}
