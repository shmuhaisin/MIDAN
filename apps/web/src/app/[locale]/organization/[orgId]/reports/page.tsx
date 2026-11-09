import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RecruitmentFunnel, TrendChart } from '@/components/command-charts';
import { EmptyState } from '@/components/ui';
import { Masthead, Panel, Segmented, StageBar, STAGE_RANK } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';
import { orgBasics, orgInterviews, orgJobReports, PIPELINE, weeklyApplications } from '@/lib/org-data';
import { getSession } from '@/lib/session';

const RANGES = [4, 12, 26] as const;

/** Bars for a small set of counts, longest proportional to the largest. */
function Bars({ rows, color, format }: { rows: { key: string; label: string; value: number }[]; color: string; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="flex items-baseline justify-between gap-3 text-sm"><span className={r.value ? '' : 'text-muted'}>{r.label}</span><span className="num font-display text-lg font-bold">{format(r.value)}</span></span>
          <span aria-hidden className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Reports for the organization, computed from its own records only. What the data can't support (time to hire, rates
 * between stages, comparisons across assessment versions) isn't shown, and the page says so.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ range?: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs, applications } = await orgBasics(orgId);
  if (!org) notFound();
  const [reports, interviews] = await Promise.all([orgJobReports(orgId, jobs), orgInterviews(orgId, applications)]);
  const t = await getTranslations({ locale, namespace: 'orgReports' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const tg = await getTranslations({ locale, namespace: 'org' });
  const tc = await getTranslations({ locale, namespace: 'command' });
  const n = (v: number) => number(locale, v);
  const base = `/${locale}/organization/${orgId}`;
  const rangeParam = (await searchParams).range;
  const range = RANGES.find((r) => String(r) === rangeParam) ?? 12;
  const count = (list: typeof applications, ...statuses: string[]) => list.filter((a) => statuses.includes(a.status)).length;
  const weeks = weeklyApplications(applications, range);
  const short = (d: Date) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { day: 'numeric', month: 'short' }).format(d);
  const interviewStates = ['invited', 'accepted', 'reschedule_requested', 'completed', 'cancelled', 'no_show'] as const;
  const eyebrow = pick(locale, org.name_ar, org.name_en);

  if (jobs.length === 0) {
    return (
      <div className="space-y-8">
        <Masthead eyebrow={eyebrow} title={to('reports')} lead={t('lead')} />
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')}><Link href={`/organization/${orgId}/jobs?new=1`} className="btn btn-primary btn-sm">{t('createJob')}</Link></EmptyState>
      </div>
    );
  }

  const open = applications.filter((a) => a.status in STAGE_RANK);
  const funnel = PIPELINE.map(([key], i) => ({
    key, label: to(`stage.${key}`), href: `${base}/candidates?stage=${key}`,
    reached: open.filter((a) => STAGE_RANK[a.status] >= i).length,
    current: open.filter((a) => STAGE_RANK[a.status] === i).length,
  }));

  return (
    <div className="space-y-8">
      <Masthead eyebrow={eyebrow} title={to('reports')} lead={t('lead')}>
        <Segmented label={tc('rangeLabel')} items={RANGES.map((r) => ({ key: String(r), href: `${base}/reports?range=${r}`, current: r === range, label: tc('weeks', { n: n(r) }) }))} />
      </Masthead>

      <Panel id="volume" title={t('volumeTitle')} lead={tc('trendRange', { weeks: n(range) })}>
        <TrendChart caption={t('volumeTitle')} unit={tc('perWeek')} empty={t('noApplications')}
          points={weeks.map((w) => ({ key: w.to.toISOString(), label: short(w.from), detail: `${short(w.from)} – ${short(w.to)}`, value: w.count }))} />
      </Panel>

      <Panel id="progression" title={t('progressionTitle')} lead={t('progressionLead')}>
        <RecruitmentFunnel stages={funnel} labels={{ reached: tc('reached'), here: tc.raw('hereNow') as string, caption: t('progressionTitle'), empty: t('noApplications') }} />
      </Panel>

      <Panel id="jobs" flush title={t('jobsTitle')} lead={t('jobsLead')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 text-xs text-muted">
                <th scope="col" className="px-6 py-3 text-start font-semibold lg:ps-8">{tg('job')}</th>
                <th scope="col" className="w-48 px-3 py-3 text-start font-semibold">{t('col.stages')}</th>
                <th scope="col" className="px-3 py-3 text-end font-semibold">{t('col.applications')}</th>
                <th scope="col" className="px-3 py-3 text-end font-semibold">{t('col.inAssessment')}</th>
                <th scope="col" className="px-3 py-3 text-end font-semibold">{t('col.submitted')}</th>
                <th scope="col" className="px-3 py-3 text-end font-semibold">{t('col.shortlisted')}</th>
                <th scope="col" className="px-6 py-3 text-end font-semibold lg:pe-8">{t('col.hired')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => {
                const apps = applications.filter((a) => (a.jobs.id ?? a.job_id) === j.id);
                const attempts = reports.find((r) => r.job.id === j.id)?.attempts ?? [];
                const segments = PIPELINE.map(([key, sts]) => ({ key, label: to(`stage.${key}`), value: apps.filter((a) => (sts as readonly string[]).includes(a.status)).length }));
                return (
                  <tr key={j.id} className="hover:bg-surface-2/40">
                    <th scope="row" className="px-6 py-4 text-start font-normal lg:ps-8">
                      <Link href={`/organization/${orgId}/jobs/${j.id}`} className="block font-semibold hover:text-primary">{pick(locale, j.title_ar, j.title_en)}</Link>
                      <span className="text-xs text-muted">{tg(`jobStatus.${j.status}`)}</span>
                    </th>
                    <td className="px-3 py-4"><StageBar segments={segments} label={segments.map((s) => `${s.label}: ${n(s.value)}`).join('، ')} /></td>
                    <td className="num px-3 py-4 text-end font-display text-lg font-bold">{n(apps.length)}</td>
                    <td className="num px-3 py-4 text-end">{n(attempts.filter((x) => ['invited', 'in_progress'].includes(x.status)).length)}</td>
                    <td className="num px-3 py-4 text-end">{n(attempts.filter((x) => x.status === 'submitted').length)}</td>
                    <td className="num px-3 py-4 text-end">{n(count(apps, 'shortlisted'))}</td>
                    <td className="num px-6 py-4 text-end lg:pe-8">{n(count(apps, 'hired'))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="interviews" title={t('interviewsTitle')} lead={t('interviewsLead')}>
          {interviews.length === 0 ? <p className="text-sm text-muted">{t('noInterviews')}</p> : (
            <Bars format={n} color="var(--brand-green)" rows={interviewStates.map((s) => ({ key: s, label: t(`interview.${s}`), value: interviews.filter((i) => i.status === s).length }))} />
          )}
        </Panel>
        <Panel id="outcomes" title={t('outcomesTitle')} lead={t('outcomesLead')}>
          <Bars format={n} color="var(--brand-gold)" rows={[
            { key: 'hired', label: t('outcome.hired'), value: count(applications, 'hired') },
            { key: 'shortlisted', label: t('outcome.shortlisted'), value: count(applications, 'shortlisted') },
            { key: 'rejected', label: t('outcome.rejected'), value: count(applications, 'rejected') },
          ]} />
        </Panel>
      </div>

      <p className="text-xs leading-relaxed text-muted">{t('limits')}</p>
    </div>
  );
}
