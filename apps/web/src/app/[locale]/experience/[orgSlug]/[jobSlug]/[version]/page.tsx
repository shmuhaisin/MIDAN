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
  const oldAddress = /^\d{1,9}$/.test(version);
  if (!oldAddress && !/^[0-9a-f-]{36}$/.test(version)) notFound();
  const data = await apiForPage<ExperienceData>(`/experience/${encodeURIComponent(orgSlug)}/${encodeURIComponent(jobSlug)}/${version}`);
  if (!data) notFound();
  // Links from before a job could have several assessments used a version number.
  if (oldAddress) return redirect({ href: `/experience/${orgSlug}/${jobSlug}/${data.version.id}`, locale });
  const logo = (data.branding as { logo_path?: string | null } | null)?.logo_path;
  const logoUrl = logo ? `${process.env.SUPABASE_URL}/storage/v1/object/public/organization-assets/${logo}` : null;
  return <Experience data={data} logoUrl={logoUrl} />;
}
