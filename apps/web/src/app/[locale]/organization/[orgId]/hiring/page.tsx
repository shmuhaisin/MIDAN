import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApplicantStatus } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Masthead, STAGE_COLORS } from '@/components/workspace-kit';
import { canReopenApplications } from '@/lib/application-status';
import { Link, redirect } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';
import { canManageJobs, orgBasics, PIPELINE } from '@/lib/org-data';
import { getSession } from '@/lib/session';

/**
 * The hiring pipeline as columns, one per stage, with every applicant where the database says they are. The status
 * control on each card offers only the moves the database allows from that status; it explains nothing it can't do.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ job?: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs, applications } = await orgBasics(orgId);
  if (!org) notFound();
  const { job } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'hiringBoard' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const tg = await getTranslations({ locale, namespace: 'org' });
  const n = (v: number) => number(locale, v);
  const canManage = canManageJobs(org.my_role);
  const shown = applications.filter((a) => !job || (a.jobs.id ?? a.job_id) === job);
  const rejected = shown.filter((a) => a.status === 'rejected');

  return (
    <div className="space-y-6">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={to('hiring')} lead={t('lead')}>
        <form className="flex items-center gap-2">
          <label className="sr-only" htmlFor="hiring-job">{tg('job')}</label>
          <select id="hiring-job" name="job" defaultValue={job ?? ''} className="input mt-0 min-w-48 text-sm">
            <option value="">{t('allJobs')}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{pick(locale, j.title_ar, j.title_en)}</option>)}
          </select>
          <button type="submit" className="btn btn-secondary btn-sm">{t('show')}</button>
        </form>
      </Masthead>

      <div className="flex flex-col gap-2 text-sm text-muted sm:flex-row sm:gap-8">
        <p className="flex gap-2"><Icon name="calendar" className="mt-0.5 size-4 shrink-0 text-primary" />{t('ruleInterview')}</p>
        <p className="flex gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-primary" />{t('ruleHire')}</p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        <ol className="grid min-w-[60rem] grid-cols-6 gap-3">
          {PIPELINE.map(([key, statuses], i) => {
            const items = shown.filter((a) => (statuses as readonly string[]).includes(a.status));
            return (
              <li key={key} className="flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface-2/40">
                <span aria-hidden className="h-1" style={{ background: STAGE_COLORS[i] }} />
                <div className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
                  <span className="text-sm font-semibold">{to(`stage.${key}`)}</span>
                  <span className="num font-display text-xl font-bold">{n(items.length)}</span>
                </div>
                <ul className="flex-1 space-y-2 p-2 pt-1">
                  {items.length === 0 && <li className="rounded-[var(--radius-control)] border border-dashed border-border px-2 py-6 text-center text-xs text-muted">{t('emptyColumn')}</li>}
                  {items.map((a) => {
                    const name = a.users.candidate_profiles?.full_name ?? a.users.email;
                    return (
                      <li key={a.id} className="rounded-[var(--radius-control)] border border-border bg-surface p-3 shadow-[0_6px_16px_-14px_rgb(11_61_46/0.5)]">
                        <div className="flex items-center gap-2.5">
                          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,var(--surface))] text-xs font-bold text-forest dark:text-mint">{name.trim().charAt(0).toUpperCase()}</span>
                          <Link href={`/organization/${orgId}/applicants/${a.id}`} className="min-w-0 truncate text-sm font-semibold hover:text-primary">{name}</Link>
                        </div>
                        <p className="mt-1.5 truncate text-xs text-muted">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</p>
                        {canManage && <div className="mt-2.5 [&_select]:text-xs"><ApplicantStatus id={a.id} status={a.status} label={tg('changeStatus', { name })} canReopen={canReopenApplications(org.my_role)} /></div>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
      {rejected.length > 0 && (
        <p className="text-sm text-muted">{t('notSelected', { count: rejected.length, shown: n(rejected.length) })} · <Link href={`/organization/${orgId}/candidates?status=rejected`} className="link">{t('viewThem')}</Link></p>
      )}
    </div>
  );
}
