import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Humaidan, JourneyRail } from '@/components/brand';
import { CvAnalysisStatus } from '@/components/candidate';
import { WithdrawButton } from '@/components/forms';
import { Badge, statusTone } from '@/components/ui';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { formatWhen, number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Me = {
  display_name: string | null; email: string;
  candidate_profiles: { full_name: string; headline: string | null; summary: string | null; cv_path: string | null; experience: unknown[]; education: unknown[] } | null;
  candidate_skills: { skill_id: string }[];
  organization_members: { org_id: string; role: string; organizations: { name_ar: string; name_en: string; is_demo: boolean } }[];
};
type MyApplication = {
  id: string; status: string;
  jobs: { id: string; slug: string; title_ar: string; title_en: string; is_demo: boolean; organizations: { slug: string; name_ar: string; name_en: string } };
  assessment_attempts: { id: string; status: string; deadline_at: string | null; assessment_versions: { id: string; version_number: number; assessments: { title_ar: string; title_en: string } }; evaluation_results: { released_to_candidate: boolean } | null }[];
};

type Dashboard = {
  unread: number;
  interviews: { id: string; scheduled_at: string; status: string; applications: { jobs: { title_ar: string; title_en: string } } }[];
  notifications: { id: string; kind: string; params: { job_ar?: string; job_en?: string }; link: string }[];
  plan: { status: string; _count: number }[];
  analysis: CvAnalysis | null;
  recommended: { id: string; title_ar: string; title_en: string; location: string | null; organizations: { name_ar: string; name_en: string }; match: { percentage: number | null; matched: { name_ar: string; name_en: string | null }[]; gaps: unknown[] } }[];
};

const JOURNEY = ['submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated'];

function Progress({ status }: { status: string }) {
  const reached = ['shortlisted', 'hired'].includes(status) ? JOURNEY.length : JOURNEY.indexOf(status) + 1;
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {JOURNEY.map((step, i) => (
        <span key={step} style={{ height: `${6 + i * 3}px` }} className={clsx('w-3 rounded-t-sm', i < reached ? 'bg-primary' : 'bg-surface-2')} />
      ))}
    </span>
  );
}

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
  if (session.accountType === 'organization') {
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
  const showRail = !staffOnly;
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
  const pendingActions = active.flatMap((a) => a.assessment_attempts.filter((x) => ['invited', 'in_progress'].includes(x.status) && x.deadline_at).map((x) => ({ a, x })));
  const planCount = (dashboard?.plan ?? []).reduce((sum, p) => sum + p._count, 0);

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <p className="text-sm text-muted">{t('hello', { name })}</p>
        <section className="card mt-2 flex flex-wrap items-center justify-between gap-4" aria-labelledby="next-step">
          {!staffOnly && <div className="w-12 shrink-0"><Humaidan sizes="48px" /></div>}
          <div className="min-w-0 max-w-2xl flex-1">
            <h1 id="next-step" className="page-title">{next.title}</h1>
            <p className="mt-1 text-muted">{next.body}</p>
          </div>
          {next.href && (
            <Link href={next.href} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2 font-semibold text-primary-foreground">
              {next.cta}<Arrow />
            </Link>
          )}
        </section>
        {showRail && <div className="mt-4"><JourneyRail label={t('flowLabel')} steps={t.raw('flow') as string[]} done={railDone} /></div>}
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
        {pendingActions.length > 0 && (
          <section aria-labelledby="deadlines">
            <h2 id="deadlines" className="section-title">{t('deadlines')}</h2>
            <ul className="mt-3 border-t border-border">
              {pendingActions.map(({ a, x }) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{pick(locale, x.assessment_versions.assessments.title_ar, x.assessment_versions.assessments.title_en)}</span>
                    <span className="text-sm text-muted">{ta('deadline', { date: formatWhen(locale, x.deadline_at as string, zone) })}</span>
                  </span>
                  <Link href={experienceHref(a, x)} className="font-semibold text-primary underline underline-offset-4">{x.status === 'invited' ? t('startAssessment') : t('continueAssessment')}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(dashboard?.interviews.length ?? 0) > 0 && (
          <section aria-labelledby="upcoming">
            <h2 id="upcoming" className="section-title">{t('upcomingInterviews')}</h2>
            <ul className="mt-3 border-t border-border">
              {dashboard?.interviews.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
                  <span className="min-w-0">
                    <span className="block font-semibold">{pick(locale, i.applications.jobs.title_ar, i.applications.jobs.title_en)}</span>
                    <span className="text-sm text-muted">{formatWhen(locale, i.scheduled_at, zone)} · {ta(`interviewStatus.${i.status}`)}</span>
                  </span>
                  <Link href={`/interviews/${i.id}`} className="font-semibold text-primary underline underline-offset-4">{ta('openInterview')}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="my-applications">
          <h2 id="my-applications" className="section-title">{t('applications')}</h2>
          {applications.length === 0 ? (
            <p className="mt-4 text-muted">{t('noApplications')}</p>
          ) : (
            <ul className="mt-4 border-t border-border">
              {applications.map((a) => (
                <li key={a.id} className="border-b border-border py-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <div className="min-w-0">
                      <Link href={`/opportunities/${a.jobs.id}`} className="font-semibold hover:text-primary">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</Link>
                      <p className="text-sm text-muted">{pick(locale, a.jobs.organizations.name_ar, a.jobs.organizations.name_en)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={statusTone(a.status)}>{ts(a.status)}</Badge>
                      {!['withdrawn', 'rejected'].includes(a.status) && <Progress status={a.status} />}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                    {a.assessment_attempts.map((x) =>
                      x.evaluation_results?.released_to_candidate ? (
                        <Link key={x.id} href={`/reports/${x.id}`} className="font-semibold text-primary underline underline-offset-4">{named(a, x, t('viewReport'))}</Link>
                      ) : x.status === 'submitted' ? (
                        <span key={x.id} className="text-sm text-muted">{named(a, x, t('awaitingResults'))}</span>
                      ) : a.status !== 'withdrawn' && ['invited', 'in_progress'].includes(x.status) ? (
                        <Link key={x.id} href={experienceHref(a, x)} className="font-semibold text-primary underline underline-offset-4">
                          {named(a, x, x.status === 'invited' ? t('startAssessment') : t('continueAssessment'))}
                        </Link>
                      ) : null,
                    )}
                    <Link href={`/applications/${a.id}`} className="text-sm font-semibold underline underline-offset-4">{t('applicationDetails')}</Link>
                    {!['withdrawn', 'rejected', 'hired'].includes(a.status) && <WithdrawButton id={a.id} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {(dashboard?.recommended.length ?? 0) > 0 && (
          <section aria-labelledby="recommended">
            <h2 id="recommended" className="section-title">{t('recommended')}</h2>
            <p className="mt-1 text-sm text-muted">{tj('matchNote')}</p>
            <ul className="mt-3 border-t border-border">
              {dashboard?.recommended.map((job) => (
                <li key={job.id} className="border-b border-border py-3">
                  <Link href={`/opportunities/${job.id}`} className="font-semibold hover:text-primary">{pick(locale, job.title_ar, job.title_en)}</Link>
                  <p className="text-sm text-muted">{pick(locale, job.organizations.name_ar, job.organizations.name_en)}{job.location && ` · ${job.location}`}</p>
                  <p className="mt-1 text-sm">{t('recommendedBecause', { skills: job.match.matched.map((s) => pick(locale, s.name_ar, s.name_en ?? s.name_ar)).join(locale === 'ar' ? '، ' : ', ') })}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>

        <aside className="space-y-6">
          {!staffOnly && dashboard?.analysis && <CvAnalysisStatus analysis={dashboard.analysis} compact />}
          {!staffOnly && (dashboard?.notifications.length ?? 0) > 0 && (
            <section>
              <h2 className="subsection-title">{tn('title')}</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {dashboard?.notifications.map((n) => <li key={n.id}><Link href={n.link} className="hover:text-primary">{tn(`kind.${n.kind}`, { job: pick(locale, n.params.job_ar ?? '', n.params.job_en ?? '') })}</Link></li>)}
              </ul>
              <Link href="/notifications" className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-4">{tn('all')}</Link>
            </section>
          )}
          {!staffOnly && (
            <section>
              <h2 className="subsection-title">{t('development')}</h2>
              <p className="mt-1 text-sm text-muted">{planCount > 0 ? t('developmentPlan', { count: number(locale, planCount) }) : t('developmentNone')}</p>
              <Link href="/development" className="mt-2 inline-block font-semibold text-primary underline underline-offset-4">{t('developmentOpen')}</Link>
            </section>
          )}
          <section>
            <h2 className="subsection-title">{t('profile')}</h2>
            {me.candidate_profiles && (
              <p className="mt-2">
                <span className="font-medium">{me.candidate_profiles.full_name}</span>
                {me.candidate_profiles.headline && <span className="block text-sm text-muted">{me.candidate_profiles.headline}</span>}
              </p>
            )}
            {profile && (
              <div className="mt-3">
                <p className="text-sm text-muted">{t('profileProgress', { done: number(locale, profileDone), total: number(locale, profileChecks.length) })}</p>
                <span aria-hidden className="mt-1 flex gap-1">
                  {profileChecks.map((done, i) => <span key={i} className={clsx('h-1.5 flex-1 rounded-full', i < profileDone ? 'bg-primary' : 'bg-surface-2')} />)}
                </span>
              </div>
            )}
            <Link href="/profile" className="mt-2 inline-block font-semibold text-primary underline underline-offset-4">{profileDone < profileChecks.length ? t('completeProfile') : t('editProfile')}</Link>
          </section>
          {(session.accountType !== 'candidate' || me.organization_members.length > 0) && <section>
            <h2 className="subsection-title">{t('organizations')}</h2>
            <ul className="mt-2 space-y-3">
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
                <Link href="/organization/new" className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">{t('createOrganization')}</Link>
              </>
            )}
          </section>}
        </aside>
      </div>
    </>
  );
}
