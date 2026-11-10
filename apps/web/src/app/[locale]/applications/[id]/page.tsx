import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Icon } from '@/components/icons';
import { SubmittedCvButton, ShareCvButton } from '@/components/candidate';
import { WithdrawButton } from '@/components/forms';
import { Badge, statusTone, Timeline } from '@/components/ui';
import { DateTile, LaneHeader, LaneTrack, STAGE_RANK } from '@/components/workspace-kit';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { ReportBody, type ReportContent } from '@/components/development-report';
import { formatDate, formatWhen, number, pick } from '@/lib/format';

type Attempt = {
  id: string; status: string; deadline_at: string | null; expires_at: string | null; submitted_at: string | null; receipt_code: string | null;
  assessment_versions: { id: string; duration_minutes: number | null; is_timed: boolean; assessments: { title_ar: string; title_en: string } };
  evaluation_results: { released_to_candidate: boolean } | null;
};
type Application = {
  id: string; status: string; created_at: string; cover_note: string | null; has_cv: boolean; can_share_cv: boolean;
  jobs: { id: string; slug: string; title_ar: string; title_en: string; location: string | null; employment_type: string | null; organizations: { slug: string; name_ar: string; name_en: string } };
  assessment_attempts: Attempt[];
  application_status_history: { to_status: string; created_at: string }[];
  interviews: { id: string; scheduled_at: string; duration_minutes: number; time_zone: string; status: string }[];
  hiring_outcomes: { id: string; outcome: string; message_ar: string | null; message_en: string | null; issued_at: string }[];
};
type Me = { candidate_profiles: { time_zone: string } | null };

/** One application, told as its journey: where it stands on the lane, what to do next, then everything behind it. */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [application, me] = await Promise.all([apiForPage<Application>(`/me/applications/${id}`), apiForPage<Me>('/me')]);
  if (!application) notFound();
  // The development report the organization released to this candidate, if any. A failure hides only this part.
  const report = await apiForPage<{ id: string; released_at: string; content: ReportContent } | null>(`/me/applications/${id}/development-report`).catch(() => null);
  const tdr = await getTranslations({ locale, namespace: 'developmentReport' });
  const t = await getTranslations({ locale, namespace: 'application' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tm = await getTranslations({ locale, namespace: 'candidateNav' });
  const ti = await getTranslations({ locale, namespace: 'myInterviews' });
  const n = (v: number) => number(locale, v);
  const zone = me?.candidate_profiles?.time_zone ?? 'Asia/Riyadh';
  const job = application.jobs;
  const fresh = (await searchParams).new === '1';
  const open = application.assessment_attempts.filter((a) => ['invited', 'in_progress'].includes(a.status));
  const outcome = application.hiring_outcomes[0];
  const org = pick(locale, job.organizations.name_ar, job.organizations.name_en);
  const stations = td.raw('laneStages') as string[];
  const onLane = application.status in STAGE_RANK;
  const at = STAGE_RANK[application.status] ?? 0;
  const experience = (a: Attempt) => `/experience/${job.organizations.slug}/${job.slug}/${a.assessment_versions.id}`;
  const lc = locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en';
  const part = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lc, { timeZone: tz, ...o }).format(new Date(iso));
  const upcoming = application.interviews.find((i) => ['invited', 'accepted', 'reschedule_requested'].includes(i.status) && Date.parse(i.scheduled_at) > Date.now() - 2 * 3600_000);

  // The one thing to show next to the lane: what the candidate can do, or what is happening without them.
  const next = open[0]
    ? { title: pick(locale, open[0].assessment_versions.assessments.title_ar, open[0].assessment_versions.assessments.title_en), body: open[0].deadline_at ? t('deadline', { date: formatWhen(locale, open[0].deadline_at, zone) }) : null, href: experience(open[0]), cta: t(open[0].status === 'invited' ? 'startAssessment' : 'continueAssessment') }
    : upcoming
      ? { title: ti('next'), body: formatWhen(locale, upcoming.scheduled_at, upcoming.time_zone), href: `/interviews/${upcoming.id}`, cta: t('openInterview') }
      : null;

  return (
    <article className="container-page space-y-8 py-8 lg:py-10">
      <Link href="/applications" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground"><Icon name="chevron" className="size-4 rotate-180" />{tm('applications')}</Link>

      {fresh && (
        <div role="status" className="rise flex items-start gap-3 rounded-[var(--radius-panel)] border border-success/30 bg-success-surface p-4">
          <Icon name="check" className="mt-0.5 text-success" />
          <div>
            <p className="font-semibold">{tj('applied')}</p>
            <p className="mt-1 text-sm">{t(open.length > 0 ? 'nextAssessment' : 'nextWait')}</p>
          </div>
        </div>
      )}

      {/* The application's journey, with the next step beside it. */}
      <header className="welcome-wash overflow-hidden rounded-[var(--radius-panel)] border border-border">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end lg:p-10">
          <div className="min-w-0">
            <p className="text-sm text-muted">{org}{job.location && ` · ${job.location}`}{job.employment_type && ` · ${tj(`employment.${job.employment_type}`)}`}</p>
            <h1 className="display-lg mt-2 text-balance max-sm:text-[2.125rem] max-sm:leading-tight">{pick(locale, job.title_ar, job.title_en)}</h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <Badge tone={statusTone(application.status)}>{ts(application.status)}</Badge>
              <span className="text-muted">{t('appliedOn', { date: formatDate(locale, application.created_at, zone) })}</span>
              <Link href={`/opportunities/${job.id}`} className="link">{t('viewJob')}</Link>
            </p>
          </div>
          {next && (
            <div className="rounded-[var(--radius-panel)] border border-border bg-background p-5 shadow-[0_18px_40px_-28px_rgb(11_61_46/0.45)]">
              <p className="label-caps">{td('nextLabel')}</p>
              <p className="mt-2 font-display text-lg leading-snug font-bold">{next.title}</p>
              {next.body && <p className="mt-1 text-sm text-muted">{next.body}</p>}
              <Link href={next.href} className="btn btn-primary btn-sm mt-4">{next.cta}<Arrow /></Link>
            </div>
          )}
        </div>
        {onLane && (
          <div className="border-t border-border bg-background/60 px-6 py-6 sm:px-8 lg:px-10">
            <div className="mb-3 hidden sm:block"><LaneHeader stations={stations} /></div>
            <LaneTrack status={application.status} stations={stations.length} label={td('laneAria', { stage: stations[at], n: n(at + 1), total: n(stations.length), status: ts(application.status) })} />
            <p className="mt-3 text-sm sm:hidden"><span className="font-semibold">{stations[at]}</span> <span className="text-muted">· {td('stageOf', { n: n(at + 1), total: n(stations.length) })}</span></p>
          </div>
        )}
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="min-w-0 space-y-10">
          {outcome && (
            <section aria-labelledby="outcome" className="on-deep rounded-[var(--radius-panel)] bg-deep p-6 text-deep-foreground sm:p-8">
              <h2 id="outcome" className="label-caps text-brand-gold!">{t('outcomeTitle')}</h2>
              <p className="mt-2 font-display text-3xl font-bold">{t(`outcome.${outcome.outcome}`)}</p>
              {pick(locale, outcome.message_ar ?? '', outcome.message_en ?? '') && <p className="mt-4 max-w-2xl leading-relaxed whitespace-pre-line text-ivory/90">{pick(locale, outcome.message_ar ?? '', outcome.message_en ?? '')}</p>}
              <p className="mt-4 text-sm text-deep-muted">{t('decidedBy', { date: formatDate(locale, outcome.issued_at, zone) })}</p>
              <Link href="/development" className="btn btn-gold btn-sm mt-5">{t('development')}<Arrow /></Link>
            </section>
          )}

          {report && (
            <section aria-labelledby="development" className="rounded-[var(--radius-panel)] border border-border bg-surface p-6">
              <h2 id="development" className="font-display text-xl font-bold">{tdr('candidateTitle')}</h2>
              <p className="mt-1 mb-4 text-sm text-muted">{tdr('candidateNote')}</p>
              <ReportBody content={report.content} />
            </section>
          )}
          <section aria-labelledby="assessments">
            <h2 id="assessments" className="flex items-center gap-3 font-display text-xl font-bold">{t('assessments')}<span className="num rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted">{n(application.assessment_attempts.length)}</span></h2>
            {application.assessment_attempts.length === 0 ? <p className="mt-3 text-muted">{t('noAssessment')}</p> : (
              <ul className="mt-4 space-y-3">
                {application.assessment_attempts.map((a) => {
                  const openNow = ['invited', 'in_progress'].includes(a.status);
                  const released = a.evaluation_results?.released_to_candidate;
                  return (
                    <li key={a.id} className={clsx('rounded-[var(--radius-panel)] border bg-surface p-5', openNow ? 'border-gold/60' : 'border-border')}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <span className="flex items-start gap-3">
                          <span aria-hidden className={clsx('grid size-10 shrink-0 place-items-center rounded-full', openNow ? 'bg-[color-mix(in_srgb,var(--brand-gold)_25%,transparent)] text-gold-text' : released ? 'bg-[color-mix(in_srgb,var(--brand-mint)_40%,transparent)] text-forest dark:text-mint' : 'bg-surface-2 text-muted')}><Icon name={released ? 'check' : 'file'} className="size-4" /></span>
                          <span>
                            <span className="block font-semibold">{pick(locale, a.assessment_versions.assessments.title_ar, a.assessment_versions.assessments.title_en)}</span>
                            <span className="text-sm text-muted">{t(`attempt.${a.status}`)}</span>
                          </span>
                        </span>
                        {openNow && <Link href={experience(a)} className="btn btn-primary btn-sm">{t(a.status === 'invited' ? 'startAssessment' : 'continueAssessment')}<Arrow /></Link>}
                        {released && <Link href={`/reports/${a.id}`} className="btn btn-primary btn-sm">{t('viewResults')}</Link>}
                      </div>
                      {(a.deadline_at && openNow) || (a.assessment_versions.is_timed && a.assessment_versions.duration_minutes) || (a.submitted_at && a.receipt_code) || (!released && a.status === 'submitted') ? (
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-sm">
                          {a.deadline_at && openNow && <span className="flex items-center gap-1.5 font-medium"><Icon name="clock" className="size-4 text-warning" />{t('deadline', { date: formatWhen(locale, a.deadline_at, zone) })}</span>}
                          {a.assessment_versions.is_timed && a.assessment_versions.duration_minutes && <span className="text-muted">{t('timed', { minutes: n(a.assessment_versions.duration_minutes) })}</span>}
                          {a.submitted_at && a.receipt_code && <span>{t('receipt', { code: a.receipt_code, date: formatWhen(locale, a.submitted_at, zone) })}</span>}
                          {!released && a.status === 'submitted' && <span className="text-muted">{t('awaitingResults')}</span>}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="interviews">
            <h2 id="interviews" className="flex items-center gap-3 font-display text-xl font-bold">{t('interviews')}<span className="num rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted">{n(application.interviews.length)}</span></h2>
            {application.interviews.length === 0 ? <p className="mt-3 text-muted">{t('noInterview')}</p> : (
              <ul className="mt-4 space-y-3">
                {application.interviews.map((i) => (
                  <li key={i.id}>
                    <Link href={`/interviews/${i.id}`} className="flex flex-wrap items-center gap-4 rounded-[var(--radius-panel)] border border-border bg-surface p-3 pe-5 transition-colors hover:border-primary/50">
                      <DateTile day={part(i.scheduled_at, i.time_zone, { day: 'numeric' })} month={part(i.scheduled_at, i.time_zone, { month: 'short' })} muted={['completed', 'cancelled', 'no_show'].includes(i.status)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{formatWhen(locale, i.scheduled_at, i.time_zone)}</span>
                        <span className="text-sm text-muted">{t(`interviewStatus.${i.status}`)} · {ti('minutes', { minutes: n(i.duration_minutes) })}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">{t('openInterview')}<Arrow /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="submitted">
            <h2 id="submitted" className="font-display text-xl font-bold">{t('submitted')}</h2>
            <p className="mt-1 text-sm text-muted">{t('submittedNote')}</p>
            {application.cover_note && <blockquote className="mt-4 border-s-4 border-gold ps-4 leading-relaxed whitespace-pre-line">{application.cover_note}</blockquote>}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {application.has_cv ? <SubmittedCvButton id={application.id} /> : <p className="text-muted">{t('noCv')}</p>}
              {application.can_share_cv && <ShareCvButton id={application.id} />}
            </div>
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
          <section aria-labelledby="history" className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <h2 id="history" className="mb-4 font-display text-lg font-bold">{t('history')}</h2>
            <Timeline label={t('history')} items={application.application_status_history.map((h) => ({ key: h.created_at + h.to_status, title: ts(h.to_status), when: formatWhen(locale, h.created_at, zone) }))} />
          </section>
          {!['withdrawn', 'rejected', 'hired'].includes(application.status) && <div className="px-1"><WithdrawButton id={application.id} /></div>}
        </aside>
      </div>
    </article>
  );
}
