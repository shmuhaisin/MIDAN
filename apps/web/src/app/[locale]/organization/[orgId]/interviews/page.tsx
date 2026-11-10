import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { Badge, statusTone } from '@/components/ui';
import { DateTile, Masthead, Panel } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { formatWhen, number, pick, intlLocale } from '@/lib/format';
import { orgBasics, orgInterviews, type OrgInterview } from '@/lib/org-data';
import { getSession } from '@/lib/session';

/**
 * Interviews across the organization, as an agenda: the coming ones grouped by day, then the past ones. Scheduling
 * stays on the applicant's page, because an interview needs a shortlisted application first.
 */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs, applications } = await orgBasics(orgId);
  if (!org) notFound();
  const interviews = await orgInterviews(orgId, applications);
  const t = await getTranslations({ locale, namespace: 'orgInterviews' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const ta = await getTranslations({ locale, namespace: 'application' });
  const n = (v: number) => number(locale, v);
  const now = Date.now();
  const DONE = ['completed', 'cancelled', 'no_show'];
  const upcoming = interviews.filter((i) => !DONE.includes(i.status) && new Date(i.scheduled_at).getTime() >= now - 3600_000);
  const past = interviews.filter((i) => !upcoming.includes(i)).reverse();
  const shortlisted = applications.filter((a) => a.status === 'shortlisted');
  const lc = intlLocale(locale);
  const dayKey = (i: OrgInterview) => new Intl.DateTimeFormat('en-CA', { timeZone: i.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(i.scheduled_at));
  const part = (i: OrgInterview, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lc, { timeZone: i.time_zone, ...o }).format(new Date(i.scheduled_at));
  const days = [...new Set(upcoming.map(dayKey))];
  const jobTitle = (i: OrgInterview) => pick(locale, i.applicant.jobs.title_ar, i.applicant.jobs.title_en);
  const who = (i: OrgInterview) => i.applicant.users.candidate_profiles?.full_name ?? i.applicant.users.email;
  const summary = [
    { key: 'upcoming', value: upcoming.length },
    { key: 'awaiting', value: upcoming.filter((i) => i.status === 'invited').length },
    { key: 'confirmed', value: upcoming.filter((i) => i.status === 'accepted').length },
    { key: 'ready', value: shortlisted.length },
  ];

  return (
    <div className="space-y-8">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={to('interviews')} lead={t('lead')} />

      <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface sm:grid-cols-4">
        {summary.map((s, i) => (
          <div key={s.key} className={`p-5 ${i % 2 === 1 ? 'border-s border-border' : ''} ${i >= 2 ? 'max-sm:border-t max-sm:border-border' : ''} ${i >= 1 ? 'sm:border-s sm:border-border' : ''}`}>
            <dt className="text-xs font-semibold text-muted">{t(`summary.${s.key}`)}</dt>
            <dd className="num mt-2 font-display text-3xl font-bold">{n(s.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel id="upcoming" flush title={t('upcoming')} count={n(upcoming.length)}>
          {upcoming.length === 0 ? (
            <div className="px-6 py-12 text-center lg:px-8">
              <p className="font-semibold">{t('noUpcoming')}</p>
              <p className="mt-1 text-sm text-muted">{shortlisted.length > 0 ? t('readyToSchedule', { count: shortlisted.length }) : t('noUpcomingBody')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {days.map((d) => {
                const items = upcoming.filter((i) => dayKey(i) === d);
                return (
                  <div key={d} className="grid gap-4 px-6 py-5 sm:grid-cols-[4rem_minmax(0,1fr)] lg:px-8">
                    <div className="flex items-center gap-3 sm:block">
                      <DateTile day={part(items[0], { day: 'numeric' })} month={part(items[0], { month: 'short' })} />
                      <p className="text-sm font-semibold sm:mt-2 sm:text-center sm:text-xs sm:font-medium sm:text-muted">{part(items[0], { weekday: 'long' })}</p>
                    </div>
                    <ul className="space-y-1.5">
                      {items.map((i) => (
                        <li key={i.id}>
                          <Link href={`/interviews/${i.id}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors hover:bg-surface-2/60 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
                            <span className="num font-semibold">{new Intl.DateTimeFormat(intlLocale(locale), { timeZone: i.time_zone, hour: 'numeric', minute: '2-digit' }).format(new Date(i.scheduled_at))}</span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{who(i)}</span>
                              <span className="block truncate text-sm text-muted">{jobTitle(i)} · {t('minutes', { minutes: n(i.duration_minutes) })}</span>
                            </span>
                            <span className="col-start-2 sm:col-start-auto"><Badge tone={statusTone(i.status)}>{ta(`interviewStatus.${i.status}`)}</Badge></span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <aside className="space-y-6">
          <section aria-labelledby="schedule" className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <h2 id="schedule" className="font-display text-lg font-bold">{t('scheduleTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('scheduleLead')}</p>
            {shortlisted.length === 0 ? <p className="mt-4 text-sm text-muted">{t('noneReady')}</p> : (
              <ul className="mt-4 space-y-1">
                {shortlisted.map((a) => (
                  <li key={a.id}>
                    <Link href={`/organization/${orgId}/applicants/${a.id}#hiring-interviews`} className="flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 hover:bg-surface-2/60">
                      <Icon name="calendar" className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{a.users.candidate_profiles?.full_name ?? a.users.email}</span>
                        <span className="block truncate text-xs text-muted">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="flex gap-3 rounded-[var(--radius-panel)] bg-surface-2/60 p-4 text-sm leading-relaxed text-muted"><Icon name="shield" className="mt-0.5 size-4 shrink-0 text-primary" />{t('ruleNote')}</p>
        </aside>
      </div>

      {past.length > 0 && (
        <Panel id="past" flush title={t('past')} count={n(past.length)}>
          <ul className="divide-y divide-border">
            {past.map((i) => (
              <li key={i.id}>
                <Link href={`/interviews/${i.id}`} className="flex flex-wrap items-center gap-4 px-6 py-3.5 hover:bg-surface-2/50 lg:px-8">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{who(i)}</span>
                    <span className="block text-sm text-muted">{jobTitle(i)} · {formatWhen(locale, i.scheduled_at, i.time_zone)}</span>
                  </span>
                  <Badge tone={statusTone(i.status)}>{ta(`interviewStatus.${i.status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {jobs.length > 0 && interviews.length === 0 && shortlisted.length === 0 && <p className="text-sm text-muted">{t('howToStart')}</p>}
    </div>
  );
}
