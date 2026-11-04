import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { RegisterForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getSession()) redirect({ href: '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'auth' });
  const audience = (await searchParams).as === 'organization' ? 'organization' : 'candidate';
  const org = audience === 'organization';
  return (
    <AuthShell audience={audience} title={t(org ? 'orgRegisterTitle' : 'registerTitle')} lead={t(org ? 'orgRegisterLead' : 'registerLead')}>
      <p className="mb-6 border-s-2 border-gold ps-4 text-sm font-medium">{t('closedNote')}</p><RegisterForm audience={audience} />
    </AuthShell>
  );
}
