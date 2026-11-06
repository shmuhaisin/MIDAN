import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobsBrowser, type ExternalListing, type PublicJob } from '@/components/jobs-browser';
import { PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'jobs' });
  return { title: t('title') };
}

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ demo?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const demo = (await searchParams).demo === '1';
  const [jobs, external] = await Promise.all([api<PublicJob[]>(demo ? '/jobs?demo=1' : '/jobs'), demo ? [] : api<ExternalListing[]>('/jobs/external')]);
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title={t(demo ? 'demoTitle' : 'title')} lead={t(demo ? 'demoLead' : 'lead')} className="mb-5">
        {!demo && <Link href="/employers" className="text-sm font-semibold text-primary underline underline-offset-4">{t('browseEmployers')}</Link>}
      </PageHeader>
      <JobsBrowser jobs={jobs} external={external} demo={demo} />
    </section>
  );
}
