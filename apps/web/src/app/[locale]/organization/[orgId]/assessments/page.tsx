import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { EmptyState } from '@/components/ui';
import { Masthead, Panel } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';
import { orgBasics, orgJobReports } from '@/lib/org-data';
import { getSession } from '@/lib/session';

type ReportAttempt = Awaited<ReturnType<typeof orgJobReports>>[number]['attempts'][number] & { applications: { users?: { email?: string; candidate_profiles?: { full_name: string } | null } } };

const STATES = ['invited', 'in_progress', 'submitted', 'expired'] as const;
const STATE_COLORS: Record<(typeof STATES)[number], string> = { invited: '#A7E3C2', in_progress: '#2E9461', submitted: '#0B3D2E', expired: 'var(--border-strong)' };

/**
 * Practical assessments across the organization: submissions waiting for a person to review, then how each job's
 * assessments are progressing. Scores are never averaged across versions: the criteria differ between them.
 */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs } = await orgBasics(orgId);
  if (!org) notFound();
  const reports = await orgJobReports(orgId, jobs);
  const t = await getTranslations({ locale, namespace: 'orgAssessments' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const n = (v: number) => number(locale, v);
  const all = reports.flatMap(({ job, attempts }) => attempts.map((a) => ({ job, a: a as ReportAttempt })));
  const toReview = all.filter(({ a }) => a.status === 'submitted' && a.evaluation_results?.status !== 'reviewed');
  const reviewed = all.filter(({ a }) => a.evaluation_results?.status === 'reviewed');
  const name = (a: ReportAttempt) => a.applications.users?.candidate_profiles?.full_name || a.applications.users?.email || '—';
  const totals = STATES.map((s) => ({ s, value: all.filter(({ a }) => a.status === s).length }));

  return (
    <div className="space-y-8">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={to('assessments')} lead={t('lead')} />

      {/* The state of every assessment at a glance. */}
      <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface sm:grid-cols-4">
        {totals.map(({ s, value }, i) => (
          <div key={s} className={`p-5 ${i % 2 === 1 ? 'border-s border-border' : ''} ${i >= 2 ? 'max-sm:border-t max-sm:border-border' : ''} ${i >= 1 ? 'sm:border-s sm:border-border' : ''}`}>
            <dt className="flex items-center gap-2 text-xs font-semibold text-muted"><span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: STATE_COLORS[s] }} />{t(`state.${s}`)}</dt>
            <dd className="num mt-2 font-display text-3xl font-bold">{n(value)}</dd>
          </div>
        ))}
      </dl>

      <Panel id="to-review" flush title={t('toReview')} count={n(toReview.length)} lead={t('toReviewLead')}>
        {toReview.length === 0 ? <p className="px-6 py-10 text-center text-muted lg:px-8">{t('nothingToReview')}</p> : (
          <ul className="divide-y divide-border">
            {toReview.map(({ job, a }) => (
              <li key={a.id} className="flex flex-wrap items-center gap-4 px-6 py-4 lg:px-8">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,var(--surface))] font-display font-bold text-forest dark:text-mint">{name(a).trim().charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{name(a)}</span>
                  <span className="block text-sm text-muted">{pick(locale, job.title_ar, job.title_en)} · {pick(locale, a.assessment_versions.assessments.title_ar, a.assessment_versions.assessments.title_en)} · {t('version', { n: n(a.assessment_versions.version_number) })}</span>
                </span>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${a.evaluation_results ? 'text-info' : 'text-gold-text'}`}><span aria-hidden className="size-1.5 rounded-full bg-current" />{a.evaluation_results ? t('proposed') : t('notStarted')}</span>
                <Link href={`/organization/${orgId}/review/${a.id}`} className="btn btn-primary btn-sm">{t('review')}<Arrow /></Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="progress" flush title={t('progressTitle')} lead={t('progressLead')}>
        {reports.every((r) => r.attempts.length === 0) ? <div className="p-6 lg:p-8"><EmptyState title={t('noAttempts')} body={t('noAttemptsBody')} /></div> : (
          <ul className="divide-y divide-border">
            {reports.filter((r) => r.attempts.length > 0).map(({ job, attempts }) => {
              const parts = STATES.map((s) => ({ s, value: attempts.filter((x) => x.status === s).length }));
              return (
                <li key={job.id} className="grid gap-3 px-6 py-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:items-center lg:gap-8 lg:px-8">
                  <div className="min-w-0">
                    <Link href={`/organization/${orgId}/jobs/${job.id}`} className="block truncate font-display font-bold hover:text-primary">{pick(locale, job.title_ar, job.title_en)}</Link>
                    <span className="num text-sm text-muted">{t('attempts', { count: attempts.length, shown: n(attempts.length) })}</span>
                  </div>
                  <div>
                    <span role="img" aria-label={parts.map((p) => `${t(`state.${p.s}`)}: ${n(p.value)}`).join('، ')} className="flex h-3 overflow-hidden rounded-full bg-surface-2">
                      {parts.map((p) => p.value > 0 && <span key={p.s} className="h-full" style={{ width: `${(p.value / attempts.length) * 100}%`, background: STATE_COLORS[p.s] }} />)}
                    </span>
                    <p aria-hidden className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                      {parts.map((p) => <span key={p.s}>{t(`state.${p.s}`)} <span className="num font-semibold text-foreground">{n(p.value)}</span></span>)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {reviewed.length > 0 && <p className="text-sm text-muted">{t('reviewedCount', { count: reviewed.length, shown: n(reviewed.length) })}</p>}
    </div>
  );
}
