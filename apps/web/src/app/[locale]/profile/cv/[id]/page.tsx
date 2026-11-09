import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CvAnalysisStatus, CvReview } from '@/components/candidate';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import type { CvAnalysis } from '@/lib/candidate-actions';

type Me = { candidate_profiles: { full_name?: string; phone?: string | null; city?: string | null; headline?: string | null; summary?: string | null } | null };

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [analysis, me] = await Promise.all([apiForPage<CvAnalysis>(`/me/cv/analyses/${id}`), apiForPage<Me>('/me')]);
  if (!analysis) notFound();
  const t = await getTranslations({ locale, namespace: 'cvAnalysis' });
  return (
    <section className="container-page max-w-4xl py-8 lg:py-10">
      <Link href="/profile" className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>
      <h1 className="mt-5 page-title">{t('title')}</h1>
      <p className="mt-2 mb-8 text-muted">{t('lead')}</p>
      {analysis.status === 'awaiting_review' ? <CvReview analysis={analysis} current={me?.candidate_profiles ?? null} /> : <CvAnalysisStatus analysis={analysis} />}
      {['applied', 'dismissed'].includes(analysis.status) && <p className="text-muted">{t('closed')}</p>}
    </section>
  );
}
