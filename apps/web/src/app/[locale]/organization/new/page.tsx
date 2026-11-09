import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrganizationForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { AuthShell } from '@/components/auth-shell';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login?as=organization', locale });
  if (session.accountType === 'candidate') return redirect({ href: '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'org' });
  return (
    <AuthShell audience="organization" title={t('newTitle')} lead={t('newLead')}>
      <OrganizationForm />
    </AuthShell>
  );
}
