import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApplicantStatus } from '@/components/forms';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { Masthead, StageMeter, STAGE_COLORS } from '@/components/workspace-kit';
import { canReopenApplications } from '@/lib/application-status';
import { Link, redirect } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';
import { canManageJobs, orgBasics, PIPELINE, stageOf } from '@/lib/org-data';
import { getSession } from '@/lib/session';

/**
 * Everyone who applied, searchable and filterable by job, stage or status. The filters live in the address, so a view
 * can be shared with a colleague; the search runs here on the server over this organization's own list.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ q?: string; job?: string; stage?: string; status?: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs, applications } = await orgBasics(orgId);
  if (!org) notFound();
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'org' });
  const tc = await getTranslations({ locale, namespace: 'candidatesPage' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const n = (v: number) => number(locale, v);
  const canManage = canManageJobs(org.my_role);
  const q = (query.q ?? '').trim().toLowerCase().slice(0, 100);
  const matches = (a: (typeof applications)[number], ignoreStage = false) => {
    const name = `${a.users.candidate_profiles?.full_name ?? ''} ${a.users.email} ${a.users.candidate_profiles?.headline ?? ''}`.toLowerCase();
    if (q && !name.includes(q)) return false;
    if (query.job && (a.jobs.id ?? a.job_id) !== query.job) return false;
    if (!ignoreStage && query.stage && stageOf(a.status) !== query.stage) return false;
    if (query.status && a.status !== query.status) return false;
    return true;
  };
  const shown = applications.filter((a) => matches(a));
  const pool = applications.filter((a) => matches(a, true));
  const active = [query.q && ['q', `“${query.q}”`], query.job && ['job', pick(locale, jobs.find((j) => j.id === query.job)?.title_ar ?? '', jobs.find((j) => j.id === query.job)?.title_en ?? '')], query.stage && ['stage', query.stage === 'closed' ? tc('closed') : to(`stage.${query.stage}`)], query.status && ['status', ts(query.status)]].filter(Boolean) as [string, string][];
  const withParams = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...query, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/organization/${orgId}/candidates${p.size ? `?${p}` : ''}`;
  };
  const stageTabs = [
    { key: '', label: tc('allStages'), count: pool.length, color: undefined as string | undefined },
    ...PIPELINE.map(([key], i) => ({ key, label: to(`stage.${key}`), count: pool.filter((a) => stageOf(a.status) === key).length, color: STAGE_COLORS[i] })),
    { key: 'closed', label: tc('closed'), count: pool.filter((a) => stageOf(a.status) === 'closed').length, color: undefined },
  ];

  return (
    <div className="space-y-6">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={to('candidates')} lead={t('humanNote')} />

      {/* Stage quick filters: the pipeline itself, with how many are in each stage for the current search. */}
      <nav aria-label={tc('stage')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ol className="flex min-w-max gap-2">
          {stageTabs.map((s) => {
            const current = (query.stage ?? '') === s.key;
            return (
              <li key={s.key || 'all'}>
                <Link href={withParams({ stage: s.key || undefined })} aria-current={current ? 'true' : undefined}
                  className={clsx('flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-colors', current ? 'border-[var(--button)] bg-[var(--button)] font-semibold text-[var(--button-foreground)]' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground')}>
                  {s.color && <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: s.color }} />}
                  {s.label}
                  <span className="num font-semibold">{n(s.count)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      <form className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-border bg-surface p-2">
        {query.stage && <input type="hidden" name="stage" value={query.stage} />}
        <label className="relative min-w-[14rem] flex-[2]">
          <span className="sr-only">{tc('search')}</span>
          <Icon name="search" className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" type="search" defaultValue={query.q} placeholder={tc('searchPlaceholder')} className="input mt-0 border-transparent bg-transparent ps-10 shadow-none focus:bg-surface" />
        </label>
        <label className="min-w-[11rem] flex-1">
          <span className="sr-only">{t('job')}</span>
          <select name="job" defaultValue={query.job ?? ''} className="input mt-0">
            <option value="">{tc('allJobs')}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{pick(locale, j.title_ar, j.title_en)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">{tc('apply')}</button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold" role="status">{tc('count', { count: shown.length, shown: n(shown.length) })}</span>
        {active.map(([key, label]) => (
          <Link key={key} href={withParams({ [key]: undefined })} className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 hover:border-foreground" aria-label={tc('removeFilter', { filter: label })}>
            {label}<Icon name="close" className="size-3.5" />
          </Link>
        ))}
        {active.length > 1 && <Link href={`/organization/${orgId}/candidates`} className="link">{tc('clearAll')}</Link>}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={applications.length === 0 ? t('noApplicants') : tc('noMatch')} />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_14rem] gap-6 border-b border-border bg-surface-2/40 px-6 py-3 lg:grid">
            <span className="text-xs font-semibold text-muted">{t('candidate')}</span>
            <span className="text-xs font-semibold text-muted">{t('job')}</span>
            <span className="text-xs font-semibold text-muted">{tc('stage')}</span>
            <span className="text-xs font-semibold text-muted">{t('status')}</span>
          </div>
          <ul className="divide-y divide-border">
            {shown.map((a) => {
              const name = a.users.candidate_profiles?.full_name ?? a.users.email;
              return (
                <li key={a.id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_14rem] lg:items-center lg:gap-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,var(--surface))] font-display font-bold text-forest dark:text-mint">{name.trim().charAt(0).toUpperCase()}</span>
                    <div className="min-w-0">
                      <Link href={`/organization/${orgId}/applicants/${a.id}`} className="block truncate font-semibold hover:text-primary">{name}</Link>
                      <p className="truncate text-sm text-muted">{a.users.candidate_profiles?.headline ?? t('noProfile')}</p>
                    </div>
                  </div>
                  <p className="truncate text-sm">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</p>
                  <p className="flex flex-wrap items-center gap-3 text-sm">
                    <StageMeter status={a.status} label={ts(a.status)} />
                    <span className={clsx(a.status === 'rejected' || a.status === 'withdrawn' ? 'text-muted' : 'font-medium')}>{ts(a.status)}</span>
                  </p>
                  {canManage ? <ApplicantStatus id={a.id} status={a.status} label={t('changeStatus', { name })} canReopen={canReopenApplications(org.my_role)} /> : <p className="text-sm text-muted">{t('readOnly')}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
