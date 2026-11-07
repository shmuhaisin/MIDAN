import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobsBrowser, type JobFilters, type JobsResult, type ListingsResult } from '@/components/jobs-browser';
import { PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'jobs' });
  return { title: t('title') };
}

const FILTERS = ['q', 'employer', 'sector', 'location', 'employment_type', 'experience_level'] as const;
const PAGE_SIZE = 12;

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const query = await searchParams;
  const demo = query.demo === '1';
  const filters = Object.fromEntries(FILTERS.map((key) => [key, (query[key] ?? '').slice(0, 200)])) as JobFilters;
  const asked = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  if (demo) asked.set('demo', '1');
  asked.set('page_size', String(PAGE_SIZE));
  const jobsQuery = new URLSearchParams(asked);
  jobsQuery.set('page', query.page ?? '1');
  const listingsQuery = new URLSearchParams();
  if (filters.q) listingsQuery.set('q', filters.q);
  if (filters.sector) listingsQuery.set('sector', filters.sector);
  listingsQuery.set('page', query.xpage ?? '1');
  listingsQuery.set('page_size', String(PAGE_SIZE));
  const [result, external] = await Promise.all([
    api<JobsResult>(`/jobs?${jobsQuery}`),
    demo ? undefined : api<ListingsResult>(`/jobs/external?${listingsQuery}`),
  ]);
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title={t(demo ? 'demoTitle' : 'title')} lead={t(demo ? 'demoLead' : 'lead')} className="mb-5">
        {!demo && <Link href="/employers" className="text-sm font-semibold text-primary underline underline-offset-4">{t('browseEmployers')}</Link>}
      </PageHeader>
      <JobsBrowser result={result} external={external} filters={filters} demo={demo} />
    </section>
  );
}
