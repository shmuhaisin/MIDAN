import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Experience, type ExperienceData } from '@/components/experience';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string; orgSlug: string; jobSlug: string; version: string }> }) {
  const { locale, orgSlug, jobSlug, version } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  if (!/^\d+$/.test(version)) notFound();
  const data = await apiForPage<ExperienceData>(`/experience/${encodeURIComponent(orgSlug)}/${encodeURIComponent(jobSlug)}/${version}`);
  if (!data) notFound();
  return <Experience data={data} />;
}
