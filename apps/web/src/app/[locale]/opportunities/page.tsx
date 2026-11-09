import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobsBrowser, type JobFilters, type JobsResult, type ListingsResult, type PublicJob } from '@/components/jobs-browser';
import { PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { myAccount } from '@/lib/account';
import { api, apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'jobs' });
  return { title: t('title') };
}

const FILTERS = ['q', 'employer', 'sector', 'location', 'employment_type', 'experience_level', 'sort'] as const;
const PAGE_SIZE = 12;

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const tn = await getTranslations({ locale, namespace: 'nav' });
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
  // A signed-in candidate can save jobs; organization accounts and visitors see no save buttons.
  const session = await getSession();
  const account = session ? await myAccount() : null;
  const isCandidate = Boolean(session && session.accountType !== 'organization' && account && !(!account.candidate_profiles && account.organization_members.length > 0));
  const savedView = isCandidate && query.saved === '1';
  const [result, external, saved] = await Promise.all([
    api<JobsResult>(`/jobs?${jobsQuery}`),
    demo || savedView ? undefined : api<ListingsResult>(`/jobs/external?${listingsQuery}`),
    isCandidate ? apiForPage<PublicJob[]>('/me/saved-jobs') : null,
  ]);
  const shown: JobsResult = savedView ? { ...result, items: saved ?? [], total: saved?.length ?? 0, page: 1 } : result;
  return (
    <section className="container-page py-10 lg:py-14">
      <PageHeader eyebrow={tn('opportunities')} title={t(demo ? 'demoTitle' : 'title')} lead={t(demo ? 'demoLead' : 'lead')} className="mb-10">
        {!demo && <Link href="/employers" className="btn btn-secondary btn-sm">{t('browseEmployers')}</Link>}
      </PageHeader>
      <JobsBrowser result={shown} external={external} filters={filters} demo={demo} savedIds={isCandidate ? (saved ?? []).map((j) => j.id) : null} savedView={savedView} />
    </section>
  );
}
