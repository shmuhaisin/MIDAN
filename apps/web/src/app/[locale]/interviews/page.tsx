import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Guide } from '@/components/guide';
import { Badge, statusTone } from '@/components/ui';
import { DateTile, Masthead } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatWhen, number, pick } from '@/lib/format';
import { candidateOnly } from '@/lib/account';
import { getSession } from '@/lib/session';

type Interview = {
  id: string; application_id: string; scheduled_at: string; duration_minutes: number; time_zone: string; status: string;
  applications: { jobs: { title_ar: string; title_en: string; organizations: { name_ar: string; name_en: string } } };
};

const DONE = ['completed', 'cancelled', 'no_show'];

/** The candidate's interviews: the next one large, the others ahead as date tiles, then the past ones. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The list is the candidate's; staff open single interviews (/interviews/[id]) from their workspace.
  await candidateOnly(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/interviews', locale });
  const interviews = (await apiForPage<Interview[]>('/me/interviews')) ?? [];
  const t = await getTranslations({ locale, namespace: 'myInterviews' });
  const ta = await getTranslations({ locale, namespace: 'application' });
  const n = (v: number) => number(locale, v);
  const now = Date.now();
  const upcoming = interviews.filter((i) => !DONE.includes(i.status) && new Date(i.scheduled_at).getTime() >= now - 2 * 3600_000)
    .sort((p, q) => Date.parse(p.scheduled_at) - Date.parse(q.scheduled_at));
  const past = interviews.filter((i) => !upcoming.includes(i));
  const lc = locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en';
  const part = (i: Interview, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lc, { timeZone: i.time_zone, ...o }).format(new Date(i.scheduled_at));
  const job = (i: Interview) => pick(locale, i.applications.jobs.title_ar, i.applications.jobs.title_en);
  const org = (i: Interview) => pick(locale, i.applications.jobs.organizations.name_ar, i.applications.jobs.organizations.name_en);
  const [next, ...later] = upcoming;

  return (
    <section className="container-page max-w-5xl space-y-10 py-8 lg:py-10">
      <Masthead eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      {interviews.length === 0 ? (
        <Guide title={t('emptyTitle')} action={<Link href="/applications" className="btn btn-primary btn-sm">{t('toApplications')}</Link>}>{t('emptyBody')}</Guide>
      ) : (
        <>
          <section aria-labelledby="upcoming">
            <h2 id="upcoming" className="flex items-center gap-3 font-display text-xl font-bold">{t('upcoming')}<span className="num rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted">{n(upcoming.length)}</span></h2>
            {!next ? <p className="mt-3 text-muted">{t('noUpcoming')}</p> : (
              <div className="mt-5 space-y-4">
                {/* The next interview, given the room it deserves. */}
                <Link href={`/interviews/${next.id}`} className="welcome-wash group grid gap-6 rounded-[var(--radius-panel)] border border-border p-6 transition-colors hover:border-primary/50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-8">
                  <span className="grid w-24 place-items-center rounded-[var(--radius-panel)] bg-[var(--button)] py-4 text-[var(--button-foreground)]">
                    <span className="text-xs font-semibold uppercase opacity-80">{part(next, { month: 'short' })}</span>
                    <span className="num font-display text-5xl leading-none font-bold">{part(next, { day: 'numeric' })}</span>
                    <span className="mt-1 text-xs opacity-80">{part(next, { weekday: 'short' })}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="label-caps">{t('next')}</span>
                    <span className="mt-1 block font-display text-2xl leading-snug font-bold group-hover:text-primary">{job(next)}</span>
                    <span className="mt-1 block text-muted">{org(next)}</span>
                    <span className="mt-3 block text-sm">{formatWhen(locale, next.scheduled_at, next.time_zone)} · {t('minutes', { minutes: n(next.duration_minutes) })}</span>
                  </span>
                  <span className="flex items-center gap-3 sm:flex-col sm:items-end">
                    <Badge tone={statusTone(next.status)}>{ta(`interviewStatus.${next.status}`)}</Badge>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">{ta('openInterview')}<Arrow /></span>
                  </span>
                </Link>
                {later.length > 0 && (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {later.map((i) => (
                      <li key={i.id}>
                        <Link href={`/interviews/${i.id}`} className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-border bg-surface p-3 transition-colors hover:border-primary/50">
                          <DateTile day={part(i, { day: 'numeric' })} month={part(i, { month: 'short' })} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{job(i)}</span>
                            <span className="block truncate text-sm text-muted">{org(i)} · {part(i, { hour: 'numeric', minute: '2-digit' })}</span>
                            <span className="block text-xs text-muted">{ta(`interviewStatus.${i.status}`)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section aria-labelledby="past">
              <h2 id="past" className="flex items-center gap-3 font-display text-xl font-bold">{t('past')}<span className="num rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted">{n(past.length)}</span></h2>
              <ul className="mt-4 divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
                {past.map((i) => (
                  <li key={i.id}>
                    <Link href={`/interviews/${i.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-surface-2/50">
                      <DateTile muted day={part(i, { day: 'numeric' })} month={part(i, { month: 'short' })} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{job(i)}</span>
                        <span className={clsx('block text-sm text-muted')}>{org(i)} · {formatWhen(locale, i.scheduled_at, i.time_zone)}</span>
                      </span>
                      <Badge tone={statusTone(i.status)}>{ta(`interviewStatus.${i.status}`)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
