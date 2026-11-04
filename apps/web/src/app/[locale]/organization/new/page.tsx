import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrganizationForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  const t = await getTranslations({ locale, namespace: 'org' });
  return (
    <section className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold">{t('newTitle')}</h1>
      <p className="mt-2 mb-8 text-lg text-muted">{t('newLead')}</p>
      <OrganizationForm />
    </section>
  );
}
