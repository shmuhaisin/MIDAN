import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getSession()) redirect({ href: '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'auth' });
  return <AuthShell title={t('loginTitle')} lead={t('loginLead')}><LoginForm /></AuthShell>;
}
