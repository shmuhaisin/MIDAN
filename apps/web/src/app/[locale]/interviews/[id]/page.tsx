import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Eyebrow } from '@/components/brand';
import { InterviewActions, InterviewJoin } from '@/components/candidate';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatWhen, number, pick } from '@/lib/format';

type Interview = {
  id: string; application_id: string; scheduled_at: string; duration_minutes: number; time_zone: string; instructions_ar: string | null; instructions_en: string | null;
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
  const t = await getTranslations({ locale, namespace: 'interview' });
  const ta = await getTranslations({ locale, namespace: 'application' });
  const job = interview.applications.jobs;
  const zone = interview.time_zone;
  const live = ['invited', 'accepted', 'reschedule_requested'].includes(interview.status);
  const instructions = pick(locale, interview.instructions_ar ?? '', interview.instructions_en ?? '');
  return (
    <article className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <header>
        {interview.is_candidate && <Link href={`/applications/${interview.application_id}`} className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>}
        <Eyebrow className="mt-5 text-muted">{pick(locale, job.organizations.name_ar, job.organizations.name_en)}</Eyebrow>
        <h1 className="mt-3 font-display text-4xl font-bold">{t('title', { job: pick(locale, job.title_ar, job.title_en) })}</h1>
        <p className="mt-3 text-sm text-muted">{t('humanNote')}</p>
      </header>
      <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-surface p-5 sm:grid-cols-[auto_1fr]">
        <dt className="text-sm text-muted">{t('when')}</dt><dd className="font-semibold">{formatWhen(locale, interview.scheduled_at, zone)}</dd>
        <dt className="text-sm text-muted">{t('timeZone')}</dt><dd className="font-medium" dir="ltr">{zone}</dd>
        <dt className="text-sm text-muted">{t('duration')}</dt><dd className="font-medium">{t('minutes', { minutes: number(locale, interview.duration_minutes) })}</dd>
        <dt className="text-sm text-muted">{t('status')}</dt><dd className="font-semibold">{ta(`interviewStatus.${interview.status}`)}</dd>
        <dt className="text-sm text-muted">{t('calendar')}</dt><dd className="font-medium">{t(`calendarStatus.${interview.calendar_status}`)}</dd>
        <dt className="text-sm text-muted">{t('updated')}</dt><dd className="text-sm">{formatWhen(locale, interview.updated_at, zone)}</dd>
      </dl>
      {instructions && (
        <section aria-labelledby="instructions">
          <h2 id="instructions" className="font-display text-xl font-semibold">{t('instructions')}</h2>
          <p className="mt-1 leading-relaxed whitespace-pre-line">{instructions}</p>
        </section>
      )}
      {interview.status === 'reschedule_requested' && <p role="status" className="border-s-2 border-gold ps-4 font-medium">{t('rescheduleRequested')}</p>}
      {interview.is_candidate && <InterviewActions id={id} status={interview.status} />}
      {live && (
        <section aria-labelledby="call">
          <h2 id="call" className="mb-3 font-display text-xl font-semibold">{t('call')}</h2>
          <InterviewJoin
            id={id} opensAt={interview.join_opens_at} closesAt={interview.join_closes_at} timeZone={zone} videoAvailable={interview.video_available}
            canJoin={interview.is_candidate ? interview.status === 'accepted' : true}
          />
        </section>
      )}
      <section aria-labelledby="updates">
        <h2 id="updates" className="font-display text-xl font-semibold">{t('updates')}</h2>
        <ol className="mt-2 space-y-1.5">
          {interview.interview_events.map((e) => (
            <li key={e.created_at + e.kind} className="flex flex-wrap justify-between gap-3 text-sm">
              <span className="font-medium">{t(`event.${e.kind}`)}</span><span className="text-muted">{formatWhen(locale, e.created_at, zone)}</span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
