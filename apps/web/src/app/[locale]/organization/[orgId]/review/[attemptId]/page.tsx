import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ReviewPanel, RunEvaluation, type ReviewData } from '@/components/review';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string; attemptId: string }> }) {
  const { locale, orgId, attemptId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  if (!/^[0-9a-f-]{36}$/.test(attemptId)) notFound();
  const data = await apiForPage<ReviewData>(`/attempts/${attemptId}/evaluation`);
  if (!data) notFound();
  const t = await getTranslations({ locale, namespace: 'review' });
  const name = data.applications.users?.candidate_profiles?.full_name ?? '—';
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
      <Link href={`/organization/${orgId}/jobs/${data.applications.job_id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
        <Arrow className="rotate-180" />{t('back')}
      </Link>
      <h1 className="font-display text-4xl font-bold">{t('title', { name })}</h1>
      {data.status !== 'submitted' ? (
        <p className="text-muted">{t('notSubmitted')}</p>
      ) : (
        <>
          {!data.evaluation_results && <RunEvaluation attemptId={attemptId} />}
          <ReviewPanel data={data} />
        </>
      )}
    </div>
  );
}
