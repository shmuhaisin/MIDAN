import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrganizationForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login?as=organization', locale });
  if (session.accountType === 'candidate') return redirect({ href: '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'org' });
  return (
    <section className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="page-title">{t('newTitle')}</h1>
      <p className="mt-2 mb-8 text-muted">{t('newLead')}</p>
      <OrganizationForm />
    </section>
  );
}
