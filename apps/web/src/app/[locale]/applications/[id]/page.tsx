import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow } from '@/components/brand';
import { SubmittedCvButton } from '@/components/candidate';
import { WithdrawButton } from '@/components/forms';
import { Badge, statusTone } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatDate, formatWhen, number, pick } from '@/lib/format';

type Attempt = {
  id: string; status: string; deadline_at: string | null; expires_at: string | null; submitted_at: string | null; receipt_code: string | null;
  assessment_versions: { id: string; duration_minutes: number | null; is_timed: boolean; assessments: { title_ar: string; title_en: string } };
  evaluation_results: { released_to_candidate: boolean } | null;
};
type Application = {
  id: string; status: string; created_at: string; cover_note: string | null; has_cv: boolean;
  jobs: { id: string; slug: string; title_ar: string; title_en: string; location: string | null; employment_type: string | null; organizations: { slug: string; name_ar: string; name_en: string } };
  assessment_attempts: Attempt[];
  application_status_history: { to_status: string; created_at: string }[];
  interviews: { id: string; scheduled_at: string; duration_minutes: number; time_zone: string; status: string }[];
  hiring_outcomes: { id: string; outcome: string; message_ar: string | null; message_en: string | null; issued_at: string }[];
};
type Me = { candidate_profiles: { time_zone: string } | null };

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [application, me] = await Promise.all([apiForPage<Application>(`/me/applications/${id}`), apiForPage<Me>('/me')]);
  if (!application) notFound();
  const t = await getTranslations({ locale, namespace: 'application' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  const zone = me?.candidate_profiles?.time_zone ?? 'Asia/Riyadh';
  const job = application.jobs;
  const fresh = (await searchParams).new === '1';
  const open = application.assessment_attempts.filter((a) => ['invited', 'in_progress'].includes(a.status));
  const outcome = application.hiring_outcomes[0];
  return (
    <>
      <article className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        <header>
          {fresh && (
            <div role="status" className="mb-6 rounded-lg bg-accent p-4 text-accent-foreground">
              <p className="font-semibold">{tj('applied')}</p>
              <p className="mt-1 text-sm">{t(open.length > 0 ? 'nextAssessment' : 'nextWait')}</p>
            </div>
          )}
          <Eyebrow className="text-muted">
            {pick(locale, job.organizations.name_ar, job.organizations.name_en)}{job.location && ` · ${job.location}`}{job.employment_type && ` · ${tj(`employment.${job.employment_type}`)}`}
          </Eyebrow>
          <h1 className="mt-3 page-title">{pick(locale, job.title_ar, job.title_en)}</h1>
          <p className="mt-3 text-muted">{t('appliedOn', { date: formatDate(locale, application.created_at, zone) })}</p>
          <p className="mt-2"><span className="text-sm text-muted">{t('recruitmentStatus')}: </span><Badge tone={statusTone(application.status)}>{ts(application.status)}</Badge></p>
          <Link href={`/opportunities/${job.id}`} className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-4">{t('viewJob')}</Link>
        </header>

        {outcome && (
          <section aria-labelledby="outcome" className="rounded-lg bg-surface p-5">
            <h2 id="outcome" className="section-title">{t('outcomeTitle')}</h2>
            <p className="mt-2 text-lg font-semibold">{t(`outcome.${outcome.outcome}`)}</p>
            {pick(locale, outcome.message_ar ?? '', outcome.message_en ?? '') && <p className="mt-2 leading-relaxed whitespace-pre-line">{pick(locale, outcome.message_ar ?? '', outcome.message_en ?? '')}</p>}
            <p className="mt-2 text-sm text-muted">{t('decidedBy', { date: formatDate(locale, outcome.issued_at, zone) })}</p>
            <Link href="/development" className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">{t('development')}</Link>
          </section>
        )}

        <section aria-labelledby="assessments">
          <h2 id="assessments" className="section-title">{t('assessments')}</h2>
          {application.assessment_attempts.length === 0 ? <p className="mt-2 text-muted">{t('noAssessment')}</p> : (
            <ul className="mt-3 border-t border-border">
              {application.assessment_attempts.map((a) => (
                <li key={a.id} className="border-b border-border py-4">
                  <p className="font-semibold">{pick(locale, a.assessment_versions.assessments.title_ar, a.assessment_versions.assessments.title_en)}</p>
                  <p className="text-sm text-muted">{t(`attempt.${a.status}`)}</p>
                  {a.deadline_at && ['invited', 'in_progress'].includes(a.status) && <p className="mt-1 text-sm font-medium">{t('deadline', { date: formatWhen(locale, a.deadline_at, zone) })}</p>}
                  {a.assessment_versions.is_timed && a.assessment_versions.duration_minutes && <p className="text-sm text-muted">{t('timed', { minutes: number(locale, a.assessment_versions.duration_minutes) })}</p>}
                  {a.submitted_at && a.receipt_code && <p className="mt-1 text-sm">{t('receipt', { code: a.receipt_code, date: formatWhen(locale, a.submitted_at, zone) })}</p>}
                  <div className="mt-2 flex flex-wrap gap-4">
                    {['invited', 'in_progress'].includes(a.status) && (
                      <Link href={`/experience/${job.organizations.slug}/${job.slug}/${a.assessment_versions.id}`} className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-4">
                        {t(a.status === 'invited' ? 'startAssessment' : 'continueAssessment')}<Arrow />
                      </Link>
                    )}
                    {a.evaluation_results?.released_to_candidate
                      ? <Link href={`/reports/${a.id}`} className="font-semibold text-primary underline underline-offset-4">{t('viewResults')}</Link>
                      : a.status === 'submitted' && <span className="text-sm text-muted">{t('awaitingResults')}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="interviews">
          <h2 id="interviews" className="section-title">{t('interviews')}</h2>
          {application.interviews.length === 0 ? <p className="mt-2 text-muted">{t('noInterview')}</p> : (
            <ul className="mt-3 border-t border-border">
              {application.interviews.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4">
                  <span>
                    <span className="block font-semibold">{formatWhen(locale, i.scheduled_at, i.time_zone)}</span>
                    <span className="text-sm text-muted">{t(`interviewStatus.${i.status}`)}</span>
                  </span>
                  <Link href={`/interviews/${i.id}`} className="font-semibold text-primary underline underline-offset-4">{t('openInterview')}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="submitted">
          <h2 id="submitted" className="section-title">{t('submitted')}</h2>
          <p className="mt-1 text-sm text-muted">{t('submittedNote')}</p>
          <div className="mt-2">{application.has_cv ? <SubmittedCvButton id={application.id} /> : <p className="text-muted">{t('noCv')}</p>}</div>
          {application.cover_note && <p className="mt-3 whitespace-pre-line">{application.cover_note}</p>}
        </section>

        <section aria-labelledby="history">
          <h2 id="history" className="section-title">{t('history')}</h2>
          <ol className="mt-3 space-y-1.5">
            {application.application_status_history.map((h) => (
              <li key={h.created_at + h.to_status} className="flex flex-wrap justify-between gap-3 text-sm">
                <span className="font-medium">{ts(h.to_status)}</span><span className="text-muted">{formatWhen(locale, h.created_at, zone)}</span>
              </li>
            ))}
          </ol>
        </section>

        {!['withdrawn', 'rejected', 'hired'].includes(application.status) && <WithdrawButton id={application.id} />}
      </article>
    </>
  );
}
