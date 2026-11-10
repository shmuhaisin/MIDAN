import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Humaidan } from '@/components/brand';
import { Icon } from '@/components/icons';
import { JourneyRoad } from '@/components/journey-track';
import { CvAnalysisStatus } from '@/components/candidate';
import { WithdrawButton } from '@/components/forms';
import { Badge, statusTone } from '@/components/ui';
import { LaneHeader, LaneTrack } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { formatWhen, number, pick, intlLocale } from '@/lib/format';
import { getSession } from '@/lib/session';

type Me = {
  display_name: string | null; email: string;
  candidate_profiles: { full_name: string; headline: string | null; summary: string | null; cv_path: string | null; experience: unknown[]; education: unknown[] } | null;
  candidate_skills: { skill_id: string }[];
  organization_members: { org_id: string; role: string; organizations: { name_ar: string; name_en: string; is_demo: boolean } }[];
};
type MyApplication = {
  id: string; status: string; created_at?: string; updated_at?: string;
  jobs: { id: string; slug: string; title_ar: string; title_en: string; is_demo: boolean; organizations: { slug: string; name_ar: string; name_en: string } };
  assessment_attempts: { id: string; status: string; deadline_at: string | null; assessment_versions: { id: string; version_number: number; assessments: { title_ar: string; title_en: string } }; evaluation_results: { released_to_candidate: boolean } | null }[];
};

type Dashboard = {
  unread: number;
  interviews: { id: string; scheduled_at: string; duration_minutes?: number; status: string; applications: { jobs: { title_ar: string; title_en: string } } }[];
  notifications: { id: string; kind: string; params: { job_ar?: string; job_en?: string }; link: string; created_at?: string }[];
  plan: { status: string; _count: number }[];
  analysis: CvAnalysis | null;
  recommended: { id: string; title_ar: string; title_en: string; location: string | null; organizations: { name_ar: string; name_en: string }; match: { percentage: number | null; matched: { name_ar: string; name_en: string | null }[]; gaps: unknown[] } }[];
};

/** Position of each application status on the candidate's lane: applied, review, assessment, evaluated, shortlist, hired. */
const LANE: Record<string, number> = { submitted: 0, under_review: 1, assessment_invited: 2, assessment_in_progress: 2, assessment_submitted: 2, evaluated: 3, shortlisted: 4, hired: 5 };
const DAY = 86400000;

/**
 * The candidate's own workspace. A personal welcome with the one next step, then the main picture: every application
 * as a lane from applying to the decision. Around it, what is waiting on them, what is coming up and what changed.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login', locale });
  const [me, applications, dashboard] = await Promise.all([apiForPage<Me>('/me'), apiForPage<MyApplication[]>('/me/applications'), apiForPage<Dashboard>('/me/dashboard')]);
  if (!me || !applications) return redirect({ href: '/login', locale });
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });

  // Organization accounts belong in their workspace, not on the candidate dashboard.
  // The records decide (a membership and no candidate profile); the token's account type is only the person's choice.
  if (session.accountType === 'organization' || (!me.candidate_profiles && me.organization_members.length > 0)) {
    const first = me.organization_members[0];
    return redirect({ href: first ? `/organization/${first.org_id}` : '/organization/new', locale });
  }
  const name = me.candidate_profiles?.full_name ?? me.display_name ?? me.email;
  const isOrgFirst = session.accountType === 'organization';
  const active = applications.filter((a) => a.status !== 'withdrawn');
  const firstOrg = me.organization_members[0];
  const experienceHref = (a: MyApplication, x: MyApplication['assessment_attempts'][number]) =>
    `/experience/${a.jobs.organizations.slug}/${a.jobs.slug}/${x.assessment_versions.id}`;
  const open = (a: MyApplication) => a.assessment_attempts.find((x) => ['invited', 'in_progress'].includes(x.status));
  const invited = active.find((a) => open(a));
  const named = (a: MyApplication, x: MyApplication['assessment_attempts'][number], label: string) =>
    a.assessment_attempts.length > 1 ? `${label}: ${pick(locale, x.assessment_versions.assessments.title_ar, x.assessment_versions.assessments.title_en)}` : label;
  const profile = me.candidate_profiles;
  const profileChecks = [
    Boolean(profile?.headline), Boolean(profile?.summary), Boolean(profile?.experience.length),
    Boolean(profile?.education.length), me.candidate_skills.length > 0, Boolean(profile?.cv_path),
  ];
  const profileKeys = ['headline', 'summary', 'experience', 'education', 'skills', 'cv'] as const;
  const profileDone = profileChecks.filter(Boolean).length;
  const next = invited
    ? { title: t('nextInvitedTitle'), body: t('nextInvitedBody'), cta: t('startAssessment'), href: experienceHref(invited, open(invited)!) }
    : firstOrg && applications.length === 0
      ? { title: t('nextOrgTitle'), body: t('nextOrgBody'), cta: t('openOrganization'), href: `/organization/${firstOrg.org_id}` }
      : (!me.candidate_profiles || profileDone < 2) && !isOrgFirst
      ? { title: t('nextProfileTitle'), body: t('nextProfileBody'), cta: t('nextProfileCta'), href: '/profile' }
      : active.length === 0 && !isOrgFirst
        ? { title: t('nextBrowseTitle'), body: t('nextBrowseBody'), cta: t('nextBrowseCta'), href: '/opportunities' }
        : isOrgFirst && me.organization_members.length === 0
          ? { title: t('createOrganization'), body: t('createOrganizationBody'), cta: t('createOrganization'), href: '/organization/new' }
          : { title: t('nextTrackTitle'), body: t('nextTrackBody'), cta: t('nextTrackCta'), href: '/opportunities' };

  // Organization staff get a formal workspace. Humaidan guides candidates here.
  const staffOnly = isOrgFirst || (me.organization_members.length > 0 && !me.candidate_profiles && applications.length === 0);
  const attempts = active.flatMap((a) => a.assessment_attempts);
  const released = attempts.some((x) => x.evaluation_results?.released_to_candidate);
  const railDone = [
    true,
    active.length > 0,
    attempts.length > 0,
    attempts.some((x) => ['in_progress', 'submitted'].includes(x.status)),
    attempts.some((x) => x.status === 'submitted'),
    released,
    released,
  ];

  const zone = (me.candidate_profiles as { time_zone?: string } | null)?.time_zone ?? 'Asia/Riyadh';
  const tn = await getTranslations({ locale, namespace: 'notifications' });
  const ta = await getTranslations({ locale, namespace: 'application' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  const n = (v: number) => number(locale, v);
  const now = Date.now();
  const pendingActions = active.flatMap((a) => a.assessment_attempts.filter((x) => ['invited', 'in_progress'].includes(x.status)).map((x) => ({ a, x })))
    .sort((p, q) => (p.x.deadline_at ? Date.parse(p.x.deadline_at) : Infinity) - (q.x.deadline_at ? Date.parse(q.x.deadline_at) : Infinity));
  const planCount = (dashboard?.plan ?? []).reduce((sum, p) => sum + p._count, 0);
  const interviews = dashboard?.interviews ?? [];
  const toAnswer = interviews.filter((i) => i.status === 'invited');
  const waiting = pendingActions.length + toAnswer.length;
  const lanes = applications.filter((a) => a.status in LANE);
  const closed = applications.filter((a) => !(a.status in LANE));
  const stages = t.raw('laneStages') as string[];
  const flow = t.raw('flow') as string[];
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(new Date()));
  const greeting = t(hour < 12 ? 'greeting.morning' : hour < 18 ? 'greeting.afternoon' : 'greeting.evening', { name: name.split(' ')[0] });
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const ago = (iso: string) => {
    const days = Math.round((Date.parse(iso) - now) / DAY);
    return Math.abs(days) < 1 ? rtf.format(Math.round((Date.parse(iso) - now) / 3600000), 'hour') : rtf.format(days, 'day');
  };
  const dayParts = (iso: string) => ({
    day: new Intl.DateTimeFormat(intlLocale(locale), { timeZone: zone, day: 'numeric' }).format(new Date(iso)),
    month: new Intl.DateTimeFormat(intlLocale(locale), { timeZone: zone, month: 'short' }).format(new Date(iso)),
    time: new Intl.DateTimeFormat(intlLocale(locale), { timeZone: zone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
  });

  /** What the candidate can do on this lane right now, or what is happening without them. */
  const laneAction = (a: MyApplication) => {
    const report = a.assessment_attempts.find((x) => x.evaluation_results?.released_to_candidate);
    const live = a.assessment_attempts.find((x) => ['invited', 'in_progress'].includes(x.status));
    if (live) return <Link href={experienceHref(a, live)} className="btn btn-primary btn-sm">{named(a, live, live.status === 'invited' ? t('startAssessment') : t('continueAssessment'))}</Link>;
    if (report) return <Link href={`/reports/${report.id}`} className="btn btn-secondary btn-sm">{named(a, report, t('viewReport'))}</Link>;
    const note = a.status === 'hired' ? t('lane.hired') : a.status === 'shortlisted' ? t('lane.shortlisted') : a.assessment_attempts.some((x) => x.status === 'submitted') ? t('awaitingResults') : t('lane.withOrg');
    return <span className="inline-flex items-center gap-1.5 text-sm text-muted"><Icon name={a.status === 'hired' ? 'check' : 'clock'} className="size-4" />{note}</span>;
  };

  return (
    <div className="container-page py-8 lg:py-10">
      {/* Welcome: the person first, then the one thing to do next. */}
      <section aria-labelledby="welcome" className="welcome-wash relative overflow-hidden rounded-[var(--radius-panel)] border border-border">
        <div className="grid items-end gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_auto] lg:px-10 lg:pt-10 lg:pb-0">
          <div className="rise max-w-2xl lg:pb-10">
            <h1 id="welcome" className="display-lg text-balance">{greeting}</h1>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className={clsx('size-2 rounded-full', waiting ? 'bg-gold' : 'bg-primary')} />{t('waitingCount', { count: waiting, shown: n(waiting) })}</span>
              <span>{t('activeCount', { count: lanes.length, shown: n(lanes.length) })}</span>
              {interviews.length > 0 && <span>{t('interviewCount', { count: interviews.length, shown: n(interviews.length) })}</span>}
            </p>

            <div className="relative mt-7 rounded-[var(--radius-panel)] border border-border bg-background p-5 shadow-[0_18px_40px_-28px_rgb(11_61_46/0.45)] backdrop-blur-sm sm:p-6">
              {!staffOnly && <span aria-hidden className="absolute top-14 -end-2 hidden size-4 rotate-45 border-t border-e border-border bg-background md:block rtl:-rotate-45" />}
              <p className="label-caps">{t('nextLabel')}</p>
              <p className="mt-2 font-display text-2xl leading-snug font-bold">{next.title}</p>
              <p className="mt-2 leading-relaxed text-muted">{next.body}</p>
              {next.href && <Link href={next.href} className="btn btn-primary mt-5">{next.cta}<Arrow /></Link>}
            </div>
          </div>
          {!staffOnly && <div aria-hidden className="mx-auto hidden w-40 md:block lg:w-52"><Humaidan sizes="200px" idle priority /></div>}
        </div>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-12">
        <div className="min-w-0 space-y-12">
          {/* The main picture: each application's journey. */}
          <section aria-labelledby="journey">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="journey" className="section-title">{t('journeyTitle')}</h2>
                <p className="mt-1 text-sm text-muted">{t('journeyLead')}</p>
              </div>
              {applications.length > 0 && <Link href="/applications" className="link text-sm">{t('seeAll')}</Link>}
            </div>

            {lanes.length === 0 ? (
              <div className="mt-5 rounded-[var(--radius-panel)] border border-dashed border-border-strong px-6 py-8 sm:px-8">
                <JourneyRoad label={t('flowLabel')} steps={flow} done={railDone} />
                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                  <p className="max-w-md text-muted">{applications.length === 0 ? t('guideNoApplications') : t('noActive')}</p>
                  <Link href="/opportunities" className="btn btn-primary btn-sm">{t('nextBrowseCta')}<Arrow /></Link>
                </div>
              </div>
            ) : (
              <div className="mt-5 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
                {/* Station names, once, aligned with the lanes below. */}
                <div aria-hidden className="hidden border-b border-border bg-surface-2/40 px-6 py-3 md:grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8">
                  <span className="text-xs font-semibold text-muted">{t('laneJob')}</span>
                  <LaneHeader stations={stages} />
                </div>
                <ol className="divide-y divide-border">
                  {lanes.map((a, li) => {
                    const at = LANE[a.status];
                    return (
                      <li key={a.id} className="px-5 py-5 sm:px-6">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-center md:gap-8">
                          <div className="min-w-0">
                            <Link href={`/applications/${a.id}`} className="line-clamp-2 font-display text-lg leading-snug font-bold hover:text-primary">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</Link>
                            <p className="truncate text-sm text-muted">{pick(locale, a.jobs.organizations.name_ar, a.jobs.organizations.name_en)}</p>
                          </div>
                          <div>
                            <LaneTrack status={a.status} stations={stages.length} delay={li * 90} label={t('laneAria', { stage: stages[at], n: n(at + 1), total: n(stages.length), status: ts(a.status) })} />
                            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                              <span className="font-semibold">{ts(a.status)}</span>
                              <span className="text-muted md:hidden">{t('stageOf', { n: n(at + 1), total: n(stages.length) })}</span>
                              {a.updated_at && <span className="text-muted">· {t('updated', { when: ago(a.updated_at) })}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 md:ps-[calc(15rem+2rem)]">
                          {laneAction(a)}
                          <span className="ms-auto">{!['hired'].includes(a.status) && <WithdrawButton id={a.id} />}</span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {closed.length > 0 && (
                  <details className="group border-t border-border">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-3 text-sm text-muted hover:text-foreground">
                      {t('closedCount', { count: closed.length, shown: n(closed.length) })}
                      <Icon name="chevron" className="size-4 rotate-90 transition-transform group-open:-rotate-90 rtl:-rotate-90 rtl:group-open:rotate-90" />
                    </summary>
                    <ul className="divide-y divide-border border-t border-border">
                      {closed.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                          <Link href={`/applications/${a.id}`} className="font-medium hover:text-primary">{pick(locale, a.jobs.title_ar, a.jobs.title_en)} <span className="text-muted">· {pick(locale, a.jobs.organizations.name_ar, a.jobs.organizations.name_en)}</span></Link>
                          <Badge tone={statusTone(a.status)}>{ts(a.status)}</Badge>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          {(dashboard?.recommended.length ?? 0) > 0 && (
            <section aria-labelledby="recommended">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="recommended" className="section-title">{t('recommended')}</h2>
                  <p className="mt-1 text-sm text-muted">{tj('matchNote')}</p>
                </div>
                <Link href="/opportunities" className="link text-sm">{t('allOpportunities')}</Link>
              </div>
              <ul className="-mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
                {dashboard?.recommended.map((job) => (
                  <li key={job.id} className="group relative w-[78%] shrink-0 snap-start rounded-[var(--radius-panel)] border border-border bg-surface p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-border-strong sm:w-auto motion-reduce:hover:translate-y-0">
                    <p className="text-sm text-muted">{pick(locale, job.organizations.name_ar, job.organizations.name_en)}{job.location && ` · ${job.location}`}</p>
                    <Link href={`/opportunities/${job.id}`} className="mt-1 block font-display text-lg leading-snug font-bold after:absolute after:inset-0 group-hover:text-primary">{pick(locale, job.title_ar, job.title_en)}</Link>
                    {job.match.matched.length > 0 && (
                      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={t('matchedSkills')}>
                        {job.match.matched.slice(0, 4).map((s) => <li key={s.name_ar} className="rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,transparent)] px-2.5 py-0.5 text-xs font-medium text-forest dark:text-mint">{pick(locale, s.name_ar, s.name_en ?? s.name_ar)}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          {/* Waiting on you */}
          {!staffOnly && (
            <section aria-labelledby="waiting">
              <h2 id="waiting" className="flex items-center justify-between font-display text-lg font-bold">
                {t('waitingTitle')}
                {waiting > 0 && <span className="num rounded-full bg-gold px-2 text-sm text-primary-foreground">{n(waiting)}</span>}
              </h2>
              {waiting === 0 ? <p className="mt-3 rounded-[var(--radius-control)] bg-surface-2/60 px-4 py-4 text-sm text-muted">{t('waitingEmpty')}</p> : (
                <ul className="mt-3 space-y-2.5">
                  {pendingActions.map(({ a, x }) => {
                    const left = x.deadline_at ? Math.max(0, Math.floor((Date.parse(x.deadline_at) - now) / DAY)) : null;
                    return (
                      <li key={x.id}>
                        <Link href={experienceHref(a, x)} className="group block rounded-[var(--radius-panel)] border border-border bg-surface p-4 transition-colors hover:border-primary/50">
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-gold-text">{x.status === 'invited' ? t('startAssessment') : t('continueAssessment')}</span>
                              <span className="mt-0.5 block font-semibold leading-snug">{pick(locale, x.assessment_versions.assessments.title_ar, x.assessment_versions.assessments.title_en)}</span>
                              <span className="block truncate text-sm text-muted">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</span>
                            </span>
                            {left !== null && <span className={clsx('num shrink-0 rounded-[3px] px-2 py-0.5 text-xs font-bold', left <= 2 ? 'bg-warning-surface text-warning' : 'bg-surface-2 text-muted')}>{t('daysLeft', { count: left, shown: n(left) })}</span>}
                          </span>
                          {x.deadline_at && <span className="mt-2 block text-xs text-muted">{ta('deadline', { date: formatWhen(locale, x.deadline_at, zone) })}</span>}
                        </Link>
                      </li>
                    );
                  })}
                  {toAnswer.map((i) => (
                    <li key={i.id}>
                      <Link href={`/interviews/${i.id}`} className="block rounded-[var(--radius-panel)] border border-border bg-surface p-4 transition-colors hover:border-primary/50">
                        <span className="block text-xs font-semibold text-gold-text">{t('answerInvitation')}</span>
                        <span className="mt-0.5 block font-semibold">{pick(locale, i.applications.jobs.title_ar, i.applications.jobs.title_en)}</span>
                        <span className="block text-sm text-muted">{formatWhen(locale, i.scheduled_at, zone)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Coming up */}
          {interviews.length > 0 && (
            <section aria-labelledby="coming-up">
              <h2 id="coming-up" className="flex items-baseline justify-between font-display text-lg font-bold">{t('comingUpTitle')}<Link href="/interviews" className="link text-sm font-normal">{t('allInterviews')}</Link></h2>
              <ul className="mt-3 space-y-2.5">
                {interviews.slice(0, 4).map((i) => {
                  const d = dayParts(i.scheduled_at);
                  return (
                    <li key={i.id}>
                      <Link href={`/interviews/${i.id}`} className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-border bg-surface p-3 transition-colors hover:border-primary/50">
                        <span className="grid w-14 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--brand-mint)_35%,var(--surface))] py-2 text-forest dark:text-mint">
                          <span className="num font-display text-2xl leading-none font-bold">{d.day}</span>
                          <span className="text-[0.6875rem] font-semibold uppercase">{d.month}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{pick(locale, i.applications.jobs.title_ar, i.applications.jobs.title_en)}</span>
                          <span className="block text-sm text-muted">{d.time}</span>
                          <span className="block text-xs text-muted">{ta(`interviewStatus.${i.status}`)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Recent activity */}
          {!staffOnly && (
            <section aria-labelledby="activity">
              <h2 id="activity" className="flex items-baseline justify-between font-display text-lg font-bold">{t('activityTitle')}<Link href="/notifications" className="link text-sm font-normal">{tn('all')}</Link></h2>
              {(dashboard?.notifications.length ?? 0) === 0 ? <p className="mt-3 text-sm text-muted">{t('activityEmpty')}</p> : (
                <ol className="relative mt-4 space-y-4 ps-5">
                  <span aria-hidden className="absolute start-[0.3rem] top-1.5 bottom-1.5 w-px bg-border-strong" />
                  {dashboard?.notifications.map((item) => (
                    <li key={item.id} className="relative">
                      <span aria-hidden className="absolute -start-5 top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
                      <Link href={item.link} className="block text-sm leading-snug hover:text-primary">{tn(`kind.${item.kind}`, { job: pick(locale, item.params.job_ar ?? '', item.params.job_en ?? '') })}</Link>
                      {item.created_at && <span className="text-xs text-muted">{ago(item.created_at)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {/* Profile strength */}
          <section aria-labelledby="profile-card" className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 44 44" className="size-16 shrink-0 -rotate-90" aria-hidden>
                {profileChecks.map((done, i) => (
                  <circle key={i} cx="22" cy="22" r="18" fill="none" strokeWidth="5" pathLength={60} strokeDasharray="8.6 51.4" strokeDashoffset={-i * 10}
                    className={done ? 'stroke-[var(--brand-green)]' : 'stroke-[var(--surface-2)]'} />
                ))}
              </svg>
              <div className="min-w-0">
                <h2 id="profile-card" className="font-display text-lg font-bold">{t('strengthTitle')}</h2>
                <p className="text-sm text-muted">{t('profileProgress', { done: n(profileDone), total: n(profileChecks.length) })}</p>
              </div>
            </div>
            {profileDone < profileChecks.length ? (
              <ul className="mt-4 space-y-1.5 text-sm">
                {profileKeys.map((k, i) => !profileChecks[i] && (
                  <li key={k}><Link href="/profile" className="flex items-center gap-2 text-muted hover:text-primary"><span aria-hidden className="text-gold">+</span>{t(`strength.${k}`)}</Link></li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-muted">{t('strengthComplete')}</p>}
            <Link href="/profile" className="btn btn-secondary btn-sm mt-4">{profileDone < profileChecks.length ? t('completeProfile') : t('editProfile')}</Link>
          </section>

          {!staffOnly && dashboard?.analysis && <CvAnalysisStatus analysis={dashboard.analysis} compact />}
          {!staffOnly && (
            <Link href="/development" className="group flex items-center gap-4 rounded-[var(--radius-panel)] border border-border p-4 transition-colors hover:bg-surface">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,transparent)] text-forest dark:text-mint"><Icon name="growth" className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t('development')}</span>
                <span className="block text-sm text-muted">{planCount > 0 ? t('developmentPlan', { count: n(planCount) }) : t('developmentNone')}</span>
              </span>
              <Arrow className="text-muted" />
            </Link>
          )}
          {(session.accountType !== 'candidate' || me.organization_members.length > 0) && (
            <section aria-labelledby="orgs-card" className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
              <h2 id="orgs-card" className="font-display text-lg font-bold">{t('organizations')}</h2>
              <ul className="mt-3 space-y-3">
                {me.organization_members.map((m) => (
                  <li key={m.org_id}>
                    <Link href={`/organization/${m.org_id}`} className="group flex items-center justify-between gap-3 font-medium hover:text-primary">
                      <span>
                        {pick(locale, m.organizations.name_ar, m.organizations.name_en)}
                        <span className="block text-sm font-normal text-muted">{t(`role.${m.role}`)}</span>
                      </span>
                      <Arrow />
                    </Link>
                  </li>
                ))}
              </ul>
              {session.accountType !== 'candidate' && (
                <>
                  {me.organization_members.length === 0 && <p className="mt-2 text-sm text-muted">{t('createOrganizationBody')}</p>}
                  <Link href="/organization/new" className="link mt-3 inline-block">{t('createOrganization')}</Link>
                </>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
