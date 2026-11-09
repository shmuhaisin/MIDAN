import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobForm, JobStatusButtons } from '@/components/forms';
import { OrganizationListingRow, type OrgListing } from '@/components/organization-team';
import { EmptyState } from '@/components/ui';
import { Masthead, Panel, Segmented, StageBar, STAGE_COLORS } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { canManageJobs, canManageTeam, orgBasics, PIPELINE } from '@/lib/org-data';
import { getSession } from '@/lib/session';

const STATUSES = ['all', 'published', 'draft', 'closed'] as const;
const DOT: Record<string, string> = { published: 'bg-primary', draft: 'bg-gold', closed: 'bg-border-strong' };

/** Every job of the organization, by status: how many applied, where those applicants are now, and what can be done. */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string; new?: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs, applications } = await orgBasics(orgId);
  if (!org) notFound();
  const query = await searchParams;
  const status = (STATUSES as readonly string[]).includes(query.status ?? '') ? query.status! : 'all';
  const listings = canManageTeam(org.my_role) ? (await apiForPage<OrgListing[]>(`/organizations/${orgId}/listings`)) ?? [] : [];
  const t = await getTranslations({ locale, namespace: 'org' });
  const tw = await getTranslations({ locale, namespace: 'jobWizard' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const tp = await getTranslations({ locale, namespace: 'workspacePages' });
  const canManage = canManageJobs(org.my_role);
  const n = (v: number) => number(locale, v);
  const base = `/${locale}/organization/${orgId}`;
  const shown = jobs.filter((j) => status === 'all' || j.status === status);
  const applied = (jobId: string) => applications.filter((a) => (a.jobs.id ?? a.job_id) === jobId);
  const stages = PIPELINE.map(([key]) => to(`stage.${key}`));

  return (
    <div className="space-y-8">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={to('jobs')} lead={tw('lead')}>
        {canManage && <JobForm orgId={orgId} defaultOpen={query.new === '1'} />}
      </Masthead>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented label={to('jobs')} items={STATUSES.map((s) => ({
          key: s, href: `${base}/jobs${s === 'all' ? '' : `?status=${s}`}`, current: status === s,
          label: s === 'all' ? tw('all') : t(`jobStatus.${s}`), count: n(s === 'all' ? jobs.length : jobs.filter((j) => j.status === s).length),
        }))} />
        {jobs.length > 0 && (
          <ul aria-label={tp('legend')} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {stages.map((s, i) => <li key={s} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: STAGE_COLORS[i] }} />{s}</li>)}
          </ul>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={jobs.length === 0 ? t('noJobs') : tw('noneInView')} body={jobs.length === 0 ? tw('firstJobBody') : undefined} />
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
          {shown.map((job, idx) => {
            const apps = applied(job.id);
            const fresh = apps.filter((a) => a.status === 'submitted').length;
            const segments = PIPELINE.map(([key, sts], i) => ({ key, label: stages[i], value: apps.filter((a) => (sts as readonly string[]).includes(a.status)).length }));
            return (
              <li key={job.id} className={clsx('grid gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_15.5rem] lg:items-center lg:gap-8', idx > 0 && 'border-t border-border')}>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-semibold text-muted"><span aria-hidden className={clsx('size-2 rounded-full', DOT[job.status])} />{t(`jobStatus.${job.status}`)}</p>
                  <Link href={`/organization/${orgId}/jobs/${job.id}`} className="mt-1 block font-display text-xl leading-snug font-bold hover:text-primary">{pick(locale, job.title_ar, job.title_en)}</Link>
                </div>
                <Link href={`/organization/${orgId}/candidates?job=${job.id}`} className="group block min-w-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted group-hover:text-foreground"><span className="num font-display text-2xl font-bold text-foreground">{n(apps.length)}</span> {tw('applicants')}</span>
                    {fresh > 0 && <span className="rounded-[3px] bg-warning-surface px-1.5 py-0.5 text-xs font-semibold text-warning">{tw('newCount', { count: fresh })}</span>}
                  </span>
                  <StageBar className="mt-2.5" segments={segments} label={segments.map((s) => `${s.label}: ${n(s.value)}`).join('، ')} />
                </Link>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {job.status === 'draft' && canManage && <Link href={`/organization/${orgId}/jobs/${job.id}?step=1`} className="btn btn-secondary btn-sm">{tw('continueSetup')}</Link>}
                  {canManage && <JobStatusButtons orgId={orgId} jobId={job.id} status={job.status} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {listings.length > 0 && (
        <Panel id="listings" title={t('listingsTitle')} lead={t('listingsLead')}>
          <ul className="divide-y divide-border">{listings.map((l) => <OrganizationListingRow key={l.id} orgId={orgId} listing={l} />)}</ul>
        </Panel>
      )}
    </div>
  );
}
