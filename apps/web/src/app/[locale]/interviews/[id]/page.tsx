import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { Badge, statusTone, Timeline } from '@/components/ui';
import { InterviewActions, InterviewJoin } from '@/components/candidate';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { InterviewPreparation, type Preparation } from '@/components/interview-prep';
import { formatWhen, number, pick, intlLocale } from '@/lib/format';

type Interview = {
  id: string; application_id: string; org_id: string; scheduled_at: string; duration_minutes: number; time_zone: string; instructions_ar: string | null; instructions_en: string | null;
  status: string; reschedule_note: string | null; calendar_status: string; updated_at: string; join_opens_at: string; join_closes_at: string; video_available: boolean; is_candidate: boolean;
  applications: { jobs: { title_ar: string; title_en: string; organizations: { name_ar: string; name_en: string } } };
  interview_events: { kind: string; scheduled_at: string | null; created_at: string }[];
};

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const interview = await apiForPage<Interview>(`/interviews/${id}`);
  if (!interview) notFound();
  // The interviewer's preparation: staff of the organization only (the API refuses anyone else, the candidate included).
  const prep = interview.is_candidate ? null : await apiForPage<Preparation>(`/organizations/${interview.org_id}/interviews/${id}/preparation`).catch(() => null);
  const tp = await getTranslations({ locale, namespace: 'interviewPrep' });
  const t = await getTranslations({ locale, namespace: 'interview' });
  const ta = await getTranslations({ locale, namespace: 'application' });
  const job = interview.applications.jobs;
  const zone = interview.time_zone;
  const live = ['invited', 'accepted', 'reschedule_requested'].includes(interview.status);
  const instructions = pick(locale, interview.instructions_ar ?? '', interview.instructions_en ?? '');
  const when = new Date(interview.scheduled_at);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(locale), { timeZone: zone, ...o }).format(when);
  return (
    <article className="container-page py-8 lg:py-10">
      {interview.is_candidate && <Link href={`/applications/${interview.application_id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground"><Icon name="chevron" className="size-4 rotate-180" />{t('back')}</Link>}
      <header className="mt-6 max-w-3xl">
        <p className="flex items-center gap-3 text-sm font-semibold text-gold-text"><span aria-hidden className="h-px w-8 bg-gold" />{pick(locale, job.organizations.name_ar, job.organizations.name_en)}</p>
        <h1 className="display-lg mt-3 text-balance">{t('title', { job: pick(locale, job.title_ar, job.title_en) })}</h1>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="min-w-0 space-y-10">
          <section aria-label={t('when')} className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface sm:grid sm:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="on-deep deep-grain flex flex-col items-center justify-center bg-deep px-6 py-8 text-center text-deep-foreground">
              <span className="text-sm font-semibold text-brand-gold">{part({ weekday: 'long' })}</span>
              <span className="num mt-1 font-display text-6xl leading-none font-bold">{part({ day: 'numeric' })}</span>
              <span className="mt-2 text-sm text-deep-muted">{part({ month: 'long', year: 'numeric' })}</span>
            </div>
            <dl className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
              <div><dt className="text-xs text-muted">{t('when')}</dt><dd className="mt-0.5 font-semibold">{formatWhen(locale, interview.scheduled_at, zone)}</dd></div>
              <div><dt className="text-xs text-muted">{t('duration')}</dt><dd className="mt-0.5 font-semibold">{t('minutes', { minutes: number(locale, interview.duration_minutes) })}</dd></div>
              <div><dt className="text-xs text-muted">{t('status')}</dt><dd className="mt-1"><Badge tone={statusTone(interview.status)}>{ta(`interviewStatus.${interview.status}`)}</Badge></dd></div>
              <div><dt className="text-xs text-muted">{t('timeZone')}</dt><dd className="mt-0.5 font-medium" dir="ltr">{zone}</dd></div>
              <div><dt className="text-xs text-muted">{t('calendar')}</dt><dd className="mt-0.5 font-medium">{t(`calendarStatus.${interview.calendar_status}`)}</dd></div>
              <div><dt className="text-xs text-muted">{t('updated')}</dt><dd className="mt-0.5 text-sm">{formatWhen(locale, interview.updated_at, zone)}</dd></div>
            </dl>
          </section>

          {interview.status === 'reschedule_requested' && <p role="status" className="callout font-medium">{t('rescheduleRequested')}</p>}
          {interview.is_candidate && <div className="panel panel-body"><InterviewActions id={id} status={interview.status} /></div>}

          {instructions && (
            <section aria-labelledby="instructions">
              <h2 id="instructions" className="section-title">{t('instructions')}</h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line">{instructions}</p>
            </section>
          )}
          {live && (
            <section aria-labelledby="call">
              <h2 id="call" className="section-title mb-4 flex items-center gap-2"><Icon name="users" className="size-5 text-primary" />{t('call')}</h2>
              <InterviewJoin
                id={id} opensAt={interview.join_opens_at} closesAt={interview.join_closes_at} startsAt={interview.scheduled_at} minutes={interview.duration_minutes} timeZone={zone} videoAvailable={interview.video_available}
                canJoin={interview.is_candidate ? interview.status === 'accepted' : true}
              />
            </section>
          )}
          {prep && (
            <section aria-labelledby="prep">
              <h2 id="prep" className="section-title">{tp('prepTitle')}</h2>
              <Link href={`/organization/${interview.org_id}/applicants/${interview.application_id}#feedback`} className="link text-sm">{tp('openApplicant')}</Link>
              <InterviewPreparation orgId={interview.org_id} interviewId={id} prep={prep} canPrepare={interview.status !== 'cancelled'} />
            </section>
          )}
          <p className="text-sm text-muted">{t('humanNote')}</p>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <section aria-labelledby="updates" className="panel panel-body">
            <h2 id="updates" className="subsection-title mb-4">{t('updates')}</h2>
            <Timeline label={t('updates')} items={interview.interview_events.map((e) => ({ key: e.created_at + e.kind, title: t(`event.${e.kind}`), when: formatWhen(locale, e.created_at, zone) }))} />
          </section>
        </aside>
      </div>
    </article>
  );
}
