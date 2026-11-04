import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow, Humaidan } from '@/components/brand';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Report = {
  overall_score: string; ai_mode: string | null;
  assessment_attempts: { applications: { jobs: { title_ar: string; title_en: string; organizations: { name_ar: string; name_en: string } } } };
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
  const describe = (s: Report['skill_scores'][number], level: number) => {
    const row = s.skills.skill_levels.find((l) => l.level === level);
    return row ? pick(locale, row.descriptor_ar, row.descriptor_en) : '';
  };
  const strengths = report.skill_scores.filter((s) => s.level >= 3);
  const improve = report.skill_scores.filter((s) => s.level < 3);

  return (
    <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground"><Arrow className="rotate-180" />{t('back')}</Link>
      <div className="mt-6 grid items-end gap-6 sm:grid-cols-[1fr_auto]">
        <div>
          <Eyebrow className="text-muted">{t('eyebrow')} · {pick(locale, job.title_ar, job.title_en)}</Eyebrow>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 text-muted">{t('reviewedNote', { org: pick(locale, job.organizations.name_ar, job.organizations.name_en) })}</p>
          {report.ai_mode === 'demo' && <p className="mt-2 border-s-2 border-gold ps-3 text-sm font-medium">{t('demoNote')}</p>}
        </div>
        <div className="on-deep rounded-lg bg-deep p-5 text-deep-foreground">
          <p className="text-sm text-deep-muted">{t('overall')}</p>
          <p className="font-display text-5xl font-bold text-mint">{number(locale, Number(report.overall_score))}</p>
          <p className="mt-1 max-w-44 text-xs text-deep-muted">{t('overallHint')}</p>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold">{t('skills')}</h2>
        <ul className="mt-4 border-t border-border">
          {report.skill_scores.map((s) => (
            <li key={s.skills.id} className="grid items-center gap-3 border-b border-border py-4 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="font-semibold">{pick(locale, s.skills.name_ar, s.skills.name_en)} · {`L${s.level}`}</p>
                <p className="mt-1 text-muted">{describe(s, s.level)}</p>
              </div>
              <span aria-hidden className="flex items-end gap-1">
                {[0, 1, 2, 3, 4].map((l) => <span key={l} style={{ height: `${10 + l * 7}px` }} className={l <= s.level ? 'w-4 rounded-t-sm bg-primary' : 'w-4 rounded-t-sm bg-surface-2'} />)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="font-display text-2xl font-bold">{t('strengths')}</h2>
          {strengths.length === 0 ? <p className="mt-3 text-muted">{t('noStrengths')}</p> : (
            <ul className="mt-3 space-y-2">{strengths.map((s) => <li key={s.skills.id} className="font-medium">{pick(locale, s.skills.name_ar, s.skills.name_en)}</li>)}</ul>
          )}
        </section>
        <section>
          <h2 className="font-display text-2xl font-bold">{t('improve')}</h2>
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
      <div className="mx-auto mt-12 w-24"><Humaidan sizes="96px" /></div>
    </article>
  );
}
