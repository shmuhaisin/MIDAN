import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobsBrowser, type PublicJob } from '@/components/jobs-browser';
import { PageHero } from '@/components/page-kit';
import { api } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'jobs' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const jobs = await api<PublicJob[]>('/jobs');
  return (
    <>
      <PageHero ns="jobs" />
      <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6"><JobsBrowser jobs={jobs} /></section>
    </>
  );
}
