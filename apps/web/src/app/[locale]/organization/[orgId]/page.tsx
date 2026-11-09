import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { JobRanking, RecruitmentFunnel, Sparkline, TrendChart } from '@/components/command-charts';
import { Icon } from '@/components/icons';
import { Badge, statusTone } from '@/components/ui';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { canManageJobs, orgBasics, orgInterviews, PIPELINE, weeklyApplications, type OrgInterview } from '@/lib/org-data';
import { getSession } from '@/lib/session';

type Team = { members: unknown[]; invitations: unknown[] };

/** Rank of each status along the pipeline. Closed statuses have none: their last stage isn't recorded in this list. */
const RANK: Record<string, number> = { submitted: 0, under_review: 1, assessment_invited: 2, assessment_in_progress: 2, assessment_submitted: 2, evaluated: 3, shortlisted: 4, hired: 5 };
const RANGES = [4, 12, 26] as const;

/**
 * The Recruitment Command Center. An executive band (one headline figure, a ledger of the rest, what needs attention),
 * the funnel as the centerpiece, the trend over a chosen range, jobs ranked, and the interview agenda.
 * Every number is counted from this organization's own records.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ range?: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { org, jobs, applications } = await orgBasics(orgId);
  if (!org) notFound();
  const [interviews, team] = await Promise.all([orgInterviews(orgId, applications), apiForPage<Team>(`/organizations/${orgId}/team`)]);
  const t = await getTranslations({ locale, namespace: 'command' });
  const to = await getTranslations({ locale, namespace: 'orgShell' });
  const ta = await getTranslations({ locale, namespace: 'application' });
  const tg = await getTranslations({ locale, namespace: 'org' });
  const n = (v: number) => number(locale, v);
  const base = `/${locale}/organization/${orgId}`;
  const rangeParam = (await searchParams).range;
  const range = RANGES.find((r) => String(r) === rangeParam) ?? 12;
  const canManage = canManageJobs(org.my_role);
  const now = Date.now();
  const count = (...statuses: string[]) => applications.filter((a) => statuses.includes(a.status)).length;
  const upcoming = interviews.filter((i) => new Date(i.scheduled_at).getTime() >= now && !['cancelled', 'completed', 'no_show'].includes(i.status));
  const published = jobs.filter((j) => j.status === 'published');
  const drafts = jobs.filter((j) => j.status === 'draft');

  const setup = [
    { key: 'profile', done: Boolean(org.branding?.primary_color || org.branding?.welcome_ar || org.branding?.welcome_en), href: '/settings' },
    { key: 'logo', done: Boolean(org.branding?.logo_path), href: '/settings' },
    { key: 'team', done: (team?.members.length ?? 0) + (team?.invitations.length ?? 0) > 1, href: '/settings#team' },
    { key: 'job', done: jobs.length > 0, href: '/jobs?new=1' },
    { key: 'publish', done: published.length > 0, href: '/jobs' },
  ];

  /* ---- A new organization: a guided start, built from what it has actually done. ---- */
  if (jobs.length === 0 && applications.length === 0) {
    const doneCount = setup.filter((s) => s.done).length;
    return (
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <p className="label-caps">{to('workspace')}</p>
          <h1 className="display-lg mt-3 max-w-2xl text-balance">{t('welcomeTitle', { org: pick(locale, org.name_ar, org.name_en) })}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">{t('welcomeLead')}</p>
          <ol className="relative mt-10">
            <span aria-hidden className="absolute start-[1.05rem] top-4 bottom-4 w-px bg-border-strong" />
            {setup.map((s, i) => (
              <li key={s.key} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-4 py-4">
                <span aria-hidden className={clsx('relative z-10 grid size-9 place-items-center rounded-full text-sm font-bold', s.done ? 'bg-primary text-primary-foreground' : i === doneCount ? 'bg-[var(--button)] text-[var(--button-foreground)] ring-4 ring-gold/25' : 'border border-border-strong bg-background text-muted')}>{s.done ? <Icon name="check" className="size-4" /> : n(i + 1)}</span>
                <span className="min-w-0">
                  <span className="block font-display text-lg font-bold">{t(`setup.${s.key}.title`)}</span>
                  <span className="block text-sm text-muted">{t(`setup.${s.key}.body`)}</span>
                </span>
                {s.done ? <span className="text-sm font-semibold text-success">{t('done')}</span> : <Link href={`/organization/${orgId}${s.href}`} className={clsx('btn btn-sm', i === doneCount ? 'btn-primary' : 'btn-secondary')}>{t(`setup.${s.key}.cta`)}</Link>}
              </li>
            ))}
          </ol>
        </div>
        <aside className="self-start rounded-[var(--radius-panel)] border border-dashed border-border-strong p-6">
          <p className="label-caps">{t('previewLabel')}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{t('noDataYet')}</p>
        </aside>
      </div>
    );
  }

  /* ---- The command center ---- */
  const weeks = weeklyApplications(applications, range);
  const short = (d: Date) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { day: 'numeric', month: 'short' }).format(d);
  const inRange = weeks.reduce((s, w) => s + w.count, 0);
  const open = applications.filter((a) => a.status in RANK);
  const funnel = PIPELINE.map(([key], i) => ({
    key,
    label: to(`stage.${key}`),
    reached: open.filter((a) => RANK[a.status] >= i).length,
    current: open.filter((a) => RANK[a.status] === i).length,
    href: `${base}/candidates?stage=${key}`,
  }));
  const ledger = [
    { key: 'activeJobs', value: published.length, href: `${base}/jobs` },
    { key: 'review', value: count('under_review'), href: `${base}/candidates?status=under_review` },
    { key: 'shortlisted', value: count('shortlisted'), href: `${base}/hiring` },
    { key: 'pendingAssessments', value: count('assessment_invited', 'assessment_in_progress'), href: `${base}/assessments` },
    { key: 'upcoming', value: upcoming.length, href: `${base}/interviews` },
    { key: 'hired', value: count('hired'), href: `${base}/hiring` },
  ];
  const actions = [
    { key: 'review', value: count('submitted'), href: '/candidates?status=submitted' },
    { key: 'evaluate', value: count('assessment_submitted'), href: '/assessments' },
    { key: 'interviews', value: upcoming.filter((i) => new Date(i.scheduled_at).getTime() - now < 7 * 86400000).length, href: '/interviews' },
    { key: 'drafts', value: drafts.length, href: '/jobs?status=draft' },
  ].filter((a) => a.value > 0);
  const ranking = jobs.map((j) => {
    const apps = applications.filter((a) => (a.jobs.id ?? a.job_id) === j.id);
    return {
      key: j.id, label: pick(locale, j.title_ar, j.title_en), status: tg(`jobStatus.${j.status}`), href: `${base}/jobs/${j.id}`, total: apps.length,
      segments: PIPELINE.map(([key, statuses]) => ({ key, label: to(`stage.${key}`), value: apps.filter((a) => (statuses as readonly string[]).includes(a.status)).length })),
    };
  });
  const dayKey = (i: OrgInterview) => new Intl.DateTimeFormat('en-CA', { timeZone: i.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(i.scheduled_at));
  const agenda = upcoming.slice(0, 8);
  const days = [...new Set(agenda.map(dayKey))];
  const setupLeft = setup.filter((s) => !s.done);

  return (
    <div className="space-y-8">
      {/* Masthead */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-border-strong pb-6">
        <div>
          <p className="label-caps">{pick(locale, org.name_ar, org.name_en)}</p>
          <h1 className="display-lg mt-2 text-balance max-sm:text-[2.125rem] max-sm:leading-tight">{t('title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:ms-auto">
          <nav aria-label={t('rangeLabel')} className="flex rounded-[var(--radius-control)] border border-border bg-surface p-0.5 text-sm">
            {RANGES.map((r) => (
              <Link key={r} href={`/organization/${orgId}?range=${r}`} scroll={false} aria-current={r === range ? 'true' : undefined}
                className={clsx('rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 transition-colors', r === range ? 'bg-[var(--button)] font-semibold text-[var(--button-foreground)]' : 'text-muted hover:text-foreground')}>
                {t('weeks', { n: n(r) })}
              </Link>
            ))}
          </nav>
          {canManage && <Link href={`/organization/${orgId}/jobs?new=1`} className="btn btn-primary btn-sm"><span aria-hidden>+</span>{t('newJob')}</Link>}
        </div>
      </header>

      {/* A. Executive overview + E. Action center */}
      <section aria-labelledby="exec" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <h2 id="exec" className="sr-only">{t('execTitle')}</h2>
        <div className="@container overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
        <div className="grid h-full @3xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <a href={`${base}/candidates`} className="group relative flex flex-col justify-between gap-6 border-b border-border p-6 @3xl:border-e @3xl:border-b-0 lg:p-8">
            <span className="text-sm font-semibold text-muted">{t('kpi.applications')}</span>
            <span>
              <span className="num block font-display text-[clamp(3.5rem,7vw,5.5rem)] leading-none font-bold tracking-tight">{n(applications.length)}</span>
              <span className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
                <Sparkline values={weeks.map((w) => w.count)} />
                <span>{t('inRange', { count: inRange, shown: n(inRange), weeks: n(range) })}</span>
              </span>
            </span>
            <span aria-hidden className="absolute inset-x-6 bottom-0 h-0.5 origin-left scale-x-0 bg-gold transition-transform duration-500 group-hover:scale-x-100 rtl:origin-right" />
          </a>
          <dl className="grid grid-cols-2 @lg:grid-cols-3">
            {ledger.map((m, i) => (
              <a key={m.key} href={m.href} className={clsx('group flex flex-col justify-between gap-3 p-5 transition-colors hover:bg-surface-2/50', 'border-border', i % 2 === 1 && 'max-@lg:border-s', i >= 2 && 'max-@lg:border-t', i % 3 !== 0 && '@lg:border-s', i >= 3 && '@lg:border-t')}>
                <dt className="text-xs font-semibold leading-snug text-muted">{t(`kpi.${m.key}`)}</dt>
                <dd className="num font-display text-3xl font-bold group-hover:text-primary">{n(m.value)}</dd>
              </a>
            ))}
          </dl>
        </div>
        </div>

        <aside aria-labelledby="action-center" className="on-deep flex flex-col rounded-[var(--radius-panel)] bg-deep text-deep-foreground">
          <div className="flex items-center justify-between gap-3 border-b border-mint/15 px-5 py-4">
            <h2 id="action-center" className="font-display text-lg font-bold">{t('actionCenter')}</h2>
            <span className="num rounded-[3px] bg-brand-gold px-2 py-0.5 text-xs font-bold text-forest">{n(actions.reduce((s, a) => s + a.value, 0))}</span>
          </div>
          {actions.length === 0 ? <p className="p-5 text-sm text-deep-muted">{t('allClear')}</p> : (
            <ul className="flex-1 divide-y divide-mint/10">
              {actions.map((a) => (
                <li key={a.key}>
                  <Link href={`/organization/${orgId}${a.href}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-mint/5">
                    <span className="num w-10 font-display text-3xl font-bold text-brand-gold">{n(a.value)}</span>
                    <span className="min-w-0 flex-1 text-sm leading-snug">{t(`action.${a.key}`, { count: a.value })}</span>
                    <Arrow className="text-mint/60 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {setupLeft.length > 0 && (
            <Link href={`/organization/${orgId}${setupLeft[0].href}`} className="border-t border-mint/15 px-5 py-3 text-xs text-deep-muted hover:text-ivory">
              {t('setupProgress', { done: n(setup.length - setupLeft.length), total: n(setup.length) })} · {t(`setup.${setupLeft[0].key}.title`)}
            </Link>
          )}
        </aside>
      </section>

      {/* B. Funnel */}
      <section aria-labelledby="funnel" className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="funnel" className="font-display text-2xl font-bold">{t('funnelTitle')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t('funnelLead')}</p>
          </div>
          <Link href={`/organization/${orgId}/hiring`} className="link text-sm">{t('openHiring')}</Link>
        </div>
        <RecruitmentFunnel stages={funnel} labels={{ reached: t('reached'), here: t.raw('hereNow') as string, caption: t('funnelTitle'), empty: t('emptyApplications') }} />
        <p className="mt-4 text-xs text-muted">{t('funnelNote', { closed: n(applications.length - open.length) })}</p>
      </section>

      {/* C. Trend + D. Jobs */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-labelledby="trend" className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8">
          <h2 id="trend" className="font-display text-xl font-bold">{t('trendTitle')}</h2>
          <p className="mt-1 mb-6 text-sm text-muted">{t('trendRange', { weeks: n(range) })}</p>
          <TrendChart caption={t('trendTitle')} unit={t('perWeek')} empty={t('emptyApplications')}
            points={weeks.map((w) => ({ key: w.to.toISOString(), label: short(w.from), detail: `${short(w.from)} – ${short(w.to)}`, value: w.count }))} />
        </section>
        <section aria-labelledby="jobs-rank" className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <h2 id="jobs-rank" className="font-display text-xl font-bold">{t('jobsTitle')}</h2>
            <Link href={`/organization/${orgId}/jobs`} className="link text-sm">{to('jobs')}</Link>
          </div>
          <JobRanking jobs={ranking} legend={PIPELINE.map(([key]) => ({ key, label: to(`stage.${key}`) }))} empty={t('emptyApplications')} />
        </section>
      </div>

      {/* F. Upcoming interviews */}
      <section aria-labelledby="agenda" className="rounded-[var(--radius-panel)] border border-border bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-6 py-5">
          <h2 id="agenda" className="font-display text-xl font-bold">{t('agendaTitle')}</h2>
          <Link href={`/organization/${orgId}/interviews`} className="link text-sm">{to('interviews')}</Link>
        </div>
        {agenda.length === 0 ? <p className="px-6 py-10 text-center text-muted">{t('agendaEmpty')}</p> : (
          <div className="divide-y divide-border">
            {days.map((d) => {
              const items = agenda.filter((i) => dayKey(i) === d);
              const first = new Date(items[0].scheduled_at);
              return (
                <div key={d} className="grid gap-4 px-6 py-5 md:grid-cols-[9rem_minmax(0,1fr)]">
                  <p className="flex items-baseline gap-2 md:flex-col md:gap-0">
                    <span className="num font-display text-3xl leading-none font-bold">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { timeZone: items[0].time_zone, day: 'numeric' }).format(first)}</span>
                    <span className="text-sm text-muted">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { timeZone: items[0].time_zone, month: 'long' }).format(first)}</span>
                    <span className="text-sm font-semibold">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { timeZone: items[0].time_zone, weekday: 'long' }).format(first)}</span>
                  </p>
                  <ul className="space-y-2">
                    {items.map((i) => (
                      <li key={i.id}>
                        <Link href={`/interviews/${i.id}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors hover:bg-surface-2/60">
                          <span className="num font-semibold">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en', { timeZone: i.time_zone, hour: 'numeric', minute: '2-digit' }).format(new Date(i.scheduled_at))}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{i.applicant.users.candidate_profiles?.full_name ?? i.applicant.users.email}</span>
                            <span className="block truncate text-sm text-muted">{pick(locale, i.applicant.jobs.title_ar, i.applicant.jobs.title_en)} · {t('minutes', { minutes: n(i.duration_minutes) })}</span>
                          </span>
                          <Badge tone={statusTone(i.status)}>{ta(`interviewStatus.${i.status}`)}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted">{t('dataNote')}</p>
    </div>
  );
}
