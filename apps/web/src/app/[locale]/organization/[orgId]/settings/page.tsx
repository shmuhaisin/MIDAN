import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { BrandingForm } from '@/components/forms';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

type Org = {
  my_role: string;
  branding: { logo_path: string | null; industry: string | null; primary_color: string | null; accent_color: string | null; welcome_ar: string | null; welcome_en: string | null } | null;
};

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await apiForPage<Org>(`/organizations/${orgId}`);
  if (!org) notFound();
  const t = await getTranslations({ locale, namespace: 'branding' });
  const logo = org.branding?.logo_path;
  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href={`/organization/${orgId}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground"><Arrow className="rotate-180" />{t('back')}</Link>
      <h1 className="mt-5 font-display text-4xl font-bold">{t('title')}</h1>
      <p className="mt-2 mb-8 text-lg text-muted">{t('lead')}</p>
      <BrandingForm
        orgId={orgId}
        branding={org.branding}
        canEdit={['owner', 'admin'].includes(org.my_role)}
        logoUrl={logo ? `${process.env.SUPABASE_URL}/storage/v1/object/public/organization-assets/${logo}` : null}
      />
    </section>
  );
}
