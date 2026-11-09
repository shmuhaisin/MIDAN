import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Destination, EvidenceSummary, SkillLine, Tally } from '@/components/career';
import { SavePlanButton, StartPracticeButton } from '@/components/candidate';
import { Guide } from '@/components/guide';
import { Panel } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { type Career, EMPTY_CAREER, hasTarget, priorities, progressOf, resourcesOf, stationsOf } from '@/lib/career';
import { getSession } from '@/lib/session';

/**
 * The career journey's overview. It answers "where am I going, what do I already show, and what should I do next",
 * from the candidate's own records only: a target, planned activities, practice work, released results and applications.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development', locale });
  const [career, applications] = await Promise.all([apiForPage<Career>('/me/career'), apiForPage<unknown[]>('/me/applications')]);
  const t = await getTranslations({ locale, namespace: 'career' });
  const td = await getTranslations({ locale, namespace: 'development' });
  const data = career ?? EMPTY_CAREER;
  const loaded = career !== null;
  const progress = progressOf(data);
  const next = priorities(data);
  const practice = data.practice ?? [];
  const planned = (skill: string) => data.plan.some((p) => p.reference_skills.id === skill && p.kind === 'skill_goal');
  const practising = (skill: string, kind: string) => practice.some((p) => p.reference_skill_id === skill && p.kind === kind);
  const searchFor = data.target?.job_title ?? '';

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <header className="max-w-3xl">
        <p className="label-caps">{t('eyebrow')}</p>
        <h1 className="display-lg mt-2 text-balance">{t('title')}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t('lead')}</p>
      </header>

      {!loaded && <p role="alert" className="callout text-sm">{t('loadFailed')}</p>}

      <Destination locale={locale} career={data} stations={stationsOf(data, applications?.length ?? 0)} />

      {!hasTarget(data) ? (
        <Guide title={t('start.title')} outfit="original" action={<Link href="/development/roles" className="btn btn-primary btn-sm">{t('start.action')}<Arrow /></Link>}>
          {t('start.body')}
        </Guide>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Panel id="next" title={t('next.title')} lead={t('next.lead')} flush
            action={<Link href="/development/skills" className="link text-sm">{t('next.all')}</Link>}>
            {next.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted lg:px-8">{data.target?.job_family_ar ? t('next.none') : t('next.noFamily')}</p>
            ) : (
              <ol className="divide-y divide-border">
                {next.map((s, i) => (
                  <SkillLine key={s.id} locale={locale} skill={s} index={i}>
                    <SavePlanButton skillId={s.id} kind="skill_goal" saved={planned(s.id)} label={td('saveGoal')} />
                    <StartPracticeButton skillId={s.id} kind="simulated_task" started={practising(s.id, 'simulated_task')} label={td('startSimulated')} />
                    {s.resources.length > 0 && <Link href="/development/learning" className="link text-sm">{t('next.learn', { count: s.resources.length })}</Link>}
                  </SkillLine>
                ))}
              </ol>
            )}
          </Panel>

          <Panel id="evidence" title={t('evidence.title')} lead={t('evidence.lead')}>
            <EvidenceSummary locale={locale} career={data} />
          </Panel>
        </div>
      )}

      <section aria-labelledby="progress">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="progress" className="section-title">{t('progress.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('progress.lead')}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tally locale={locale} label={t('progress.goals')} done={progress.goals.done} total={progress.goals.total} href="/development/skills" />
          <Tally locale={locale} label={t('progress.courses')} done={progress.courses.done} total={progress.courses.total} href="/development/learning" />
          <Tally locale={locale} label={t('progress.certifications')} done={progress.certifications.done} total={progress.certifications.total} href="/development/learning" />
          <Tally locale={locale} label={t('progress.projects')} done={progress.projects.done} total={progress.projects.total} href="/development/practice" />
          <Tally locale={locale} label={t('progress.practice')} done={progress.practice.done} total={progress.practice.total} href="/development/practice" />
          <Tally locale={locale} label={t('progress.resources')} done={data.plan.filter((p) => p.learning_resources).length} total={resourcesOf(data).length} href="/development/learning" />
        </div>
        <p className="mt-3 text-xs text-muted">{t('progress.note')}</p>
      </section>

      <section aria-labelledby="opportunities" className="grid gap-6 rounded-[var(--radius-panel)] border border-border bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <h2 id="opportunities" className="section-title">{t('jobs.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{searchFor ? t('jobs.lead', { title: searchFor }) : t('jobs.leadNoTitle')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {searchFor && <Link href={`/opportunities?q=${encodeURIComponent(searchFor)}`} className="btn btn-primary btn-sm">{t('jobs.matching')}<Arrow /></Link>}
          <Link href={data.target?.sector_code ? `/opportunities?sector=${data.target.sector_code}` : '/opportunities'} className="btn btn-secondary btn-sm">{data.target?.sector_code ? t('jobs.sector') : t('jobs.all')}</Link>
        </div>
      </section>
    </div>
  );
}
