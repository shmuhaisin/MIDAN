import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { EvidenceSummary, SkillLine } from '@/components/career';
import { SavePlanButton, StartPracticeButton } from '@/components/candidate';
import { Guide } from '@/components/guide';
import { Panel } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { type Career, EMPTY_CAREER, evidenceOf, hasTarget } from '@/lib/career';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * The skill gap analysis, grouped by the kind of evidence behind each skill. A gap is "nothing shows it yet", never a
 * weakness and never a percentage. Released results come from the assessments' own skills and are shown separately.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development/skills', locale });
  const career = await apiForPage<Career>('/me/career');
  const t = await getTranslations({ locale, namespace: 'career' });
  const td = await getTranslations({ locale, namespace: 'development' });
  const data = career ?? EMPTY_CAREER;
  const groups = evidenceOf(data);
  const n = (v: number) => number(locale, v);
  const practice = data.practice ?? [];
  const planned = (skill: string) => data.plan.some((p) => p.reference_skills.id === skill && p.kind === 'skill_goal');
  const practising = (skill: string, kind: string) => practice.some((p) => p.reference_skill_id === skill && p.kind === kind);
  const open = [...groups.open.filter((s) => s.is_priority), ...groups.open.filter((s) => !s.is_priority)];

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <header className="max-w-3xl">
        <p className="label-caps">{t('skillsPage.eyebrow')}</p>
        <h1 className="display-lg mt-2 text-balance">{t('skillsPage.title')}</h1>
        <p className="mt-3 leading-relaxed text-muted">{td('gapsNote')}</p>
      </header>

      {career === null && <p role="alert" className="callout text-sm">{t('loadFailed')}</p>}

      {!hasTarget(data) ? (
        <Guide title={t('start.title')} action={<Link href="/development/roles" className="btn btn-primary btn-sm">{t('start.action')}<Arrow /></Link>}>{t('start.body')}</Guide>
      ) : (
        <>
          <Panel id="summary" title={t('evidence.title')} lead={t('evidence.lead')}><EvidenceSummary locale={locale} career={data} /></Panel>

          {(groups.shown.length > 0 || groups.needs.length > 0) && (
            <Panel id="results" title={t('skillsPage.resultsTitle')} lead={td('evidenceNote')}>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold">{td('strengths')}</p>
                  {groups.shown.length === 0 ? <p className="mt-1 text-sm text-muted">{t('skillsPage.noneYet')}</p> : (
                    <ul className="mt-2 flex flex-wrap gap-2">{groups.shown.map((s) => <li key={s.id} className="chip border-gold/50 bg-gold/10"><span className="num font-semibold text-gold-text">L{s.level}</span>{pick(locale, s.name_ar, s.name_en)}</li>)}</ul>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold">{td('needs')}</p>
                  {groups.needs.length === 0 ? <p className="mt-1 text-sm text-muted">{t('skillsPage.noneYet')}</p> : (
                    <ul className="mt-2 flex flex-wrap gap-2">{groups.needs.map((s) => <li key={s.id} className="chip"><span className="num font-semibold">L{s.level}</span>{pick(locale, s.name_ar, s.name_en)}</li>)}</ul>
                  )}
                </div>
              </div>
              <Link href="/development/levels" className="link mt-4 inline-block text-sm">{t('skillsPage.levelsLink')}</Link>
            </Panel>
          )}

          {data.target?.job_title && (data.title_skills ?? []).length > 0 && (
            <Panel id="title-skills" title={td('titleSkillsTitle')} lead={td('titleSkillsNote', { jobs: data.title_jobs ?? 0 })}>
              <ul className="flex flex-wrap gap-2">
                {data.title_skills!.map((s) => (
                  <li key={s.id} className={s.evidence === 'no_evidence' ? 'chip border-dashed' : 'chip border-primary/40 bg-accent/50'}>
                    {pick(locale, s.name_ar, s.name_en ?? s.name_ar)}
                    <span className="text-xs text-muted">{td(`titleEvidence.${s.evidence}`)} · {td('inJobs', { count: s.jobs })}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.target?.job_family_ar ? (
            <>
              <Panel id="open" title={t('skillsPage.openTitle')} lead={t('skillsPage.openLead')} count={n(open.length)} flush>
                {open.length === 0 ? <p className="px-6 py-6 text-sm text-muted lg:px-8">{t('skillsPage.openNone')}</p> : (
                  <ul className="divide-y divide-border">
                    {open.map((s) => (
                      <SkillLine key={s.id} locale={locale} skill={s}>
                        <span className="w-full text-sm text-muted">{td(`reason.${s.evidence}`)}</span>
                        <SavePlanButton skillId={s.id} kind="skill_goal" saved={planned(s.id)} label={td('saveGoal')} />
                        <StartPracticeButton skillId={s.id} kind="simulated_task" started={practising(s.id, 'simulated_task')} label={td('startSimulated')} />
                        <StartPracticeButton skillId={s.id} kind="portfolio_project" started={practising(s.id, 'portfolio_project')} label={td('startPortfolio')} />
                      </SkillLine>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel id="listed" title={t('skillsPage.listedTitle')} lead={t('skillsPage.listedLead')} count={n(groups.listed.length)} flush>
                {groups.listed.length === 0 ? <p className="px-6 py-6 text-sm text-muted lg:px-8">{t('skillsPage.listedNone')} <Link href="/profile" className="link">{t('skillsPage.toProfile')}</Link></p> : (
                  <ul className="divide-y divide-border">
                    {groups.listed.map((s) => (
                      <SkillLine key={s.id} locale={locale} skill={s}>
                        <span className="w-full text-sm text-muted">{td(`reason.${s.evidence}`)}</span>
                        <StartPracticeButton skillId={s.id} kind="portfolio_project" started={practising(s.id, 'portfolio_project')} label={td('startPortfolio')} />
                      </SkillLine>
                    ))}
                  </ul>
                )}
              </Panel>
              <p className="text-xs text-muted">{t('source')}</p>
            </>
          ) : (
            <Guide title={t('skillsPage.familyTitle')} action={<Link href="/development/roles" className="btn btn-secondary btn-sm">{t('start.action')}</Link>}>{td('titleSkillsNone')}</Guide>
          )}
        </>
      )}
    </div>
  );
}
