import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { PracticeTaskCard, StartPracticeButton } from '@/components/candidate';
import { Guide } from '@/components/guide';
import { Panel, Segmented } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { type Career, EMPTY_CAREER, hasTarget, PRACTICE_STATUSES, priorities } from '@/lib/career';
import { number } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Practical work for the target role: simulated tasks and portfolio projects from MIDAN's templates, with their brief,
 * instructions and deliverables. Submitted work is the candidate's evidence; MIDAN's checklist checks its shape only.
 * Nothing here is an assessment, employment, or work experience, and the page says so.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development/practice', locale });
  const statusParam = (await searchParams).status;
  const status = (PRACTICE_STATUSES as readonly string[]).includes(statusParam ?? '') ? statusParam! : null;
  const career = await apiForPage<Career>('/me/career');
  const t = await getTranslations({ locale, namespace: 'career' });
  const td = await getTranslations({ locale, namespace: 'development' });
  const data = career ?? EMPTY_CAREER;
  const n = (v: number) => number(locale, v);
  const practice = data.practice ?? [];
  const shown = status ? practice.filter((p) => p.status === status) : practice;
  const started = (skill: string, kind: string) => practice.some((p) => p.reference_skill_id === skill && p.kind === kind);
  const suggestions = priorities(data, 4);
  const evidence = practice.filter((p) => p.status === 'submitted' || p.status === 'completed');

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <header className="max-w-3xl">
        <p className="label-caps">{t('practice.eyebrow')}</p>
        <h1 className="display-lg mt-2 text-balance">{t('practice.title')}</h1>
        <p className="mt-3 leading-relaxed text-muted">{td('practiceNote')}</p>
      </header>

      {career === null && <p role="alert" className="callout text-sm">{t('loadFailed')}</p>}

      {!hasTarget(data) && practice.length === 0 ? (
        <Guide title={t('start.title')} action={<Link href="/development/roles" className="btn btn-primary btn-sm">{t('start.action')}<Arrow /></Link>}>{t('start.body')}</Guide>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="work" className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="work" className="section-title">{td('practiceTitle')}</h2>
              <div className="min-w-0 max-w-full"><Segmented label={t('practice.filter')} items={[
                { key: 'all', label: t('practice.all'), href: `/${locale}/development/practice`, current: !status, count: n(practice.length) },
                ...PRACTICE_STATUSES.map((s) => ({ key: s, label: td(`practiceStatus.${s}`), href: `/${locale}/development/practice?status=${s}`, current: status === s, count: n(practice.filter((p) => p.status === s).length) })),
              ]} /></div>
            </div>
            {shown.length === 0 ? (
              <p className="rounded-[var(--radius-panel)] border border-dashed border-border-strong px-6 py-10 text-center text-muted">{practice.length === 0 ? t('practice.empty') : t('practice.noneHere')}</p>
            ) : (
              <ul className="rounded-[var(--radius-panel)] border border-border bg-surface px-5 sm:px-6">{shown.map((p) => <PracticeTaskCard key={p.id} task={p} />)}</ul>
            )}
          </section>

          <aside className="space-y-6 self-start xl:sticky xl:top-24">
            <Panel id="evidence" title={t('practice.evidenceTitle')} lead={t('practice.evidenceLead')} count={n(evidence.length)}>
              {evidence.length === 0 ? <p className="text-sm text-muted">{t('practice.evidenceNone')}</p> : (
                <ul className="space-y-3 text-sm">
                  {evidence.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 font-medium">{locale === 'ar' ? p.title_ar : p.title_en}</span>
                      <span className={p.status === 'completed' ? 'chip shrink-0 border-primary/40 text-xs text-primary' : 'chip shrink-0 text-xs'}>{td(`practiceStatus.${p.status}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs leading-relaxed text-muted">{t('practice.notVerified')}</p>
            </Panel>

            {hasTarget(data) && (
              <Panel id="suggested" title={t('practice.suggestTitle')} lead={t('practice.suggestLead')}>
                {suggestions.length === 0 ? <p className="text-sm text-muted">{data.target?.job_family_ar ? t('next.none') : t('next.noFamily')}</p> : (
                  <ul className="space-y-4">
                    {suggestions.map((s) => (
                      <li key={s.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
                        <p className="font-semibold" dir="rtl"><bdi>{s.name_ar}</bdi></p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          <StartPracticeButton skillId={s.id} kind="simulated_task" started={started(s.id, 'simulated_task')} label={td('startSimulated')} />
                          <StartPracticeButton skillId={s.id} kind="portfolio_project" started={started(s.id, 'portfolio_project')} label={td('startPortfolio')} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
