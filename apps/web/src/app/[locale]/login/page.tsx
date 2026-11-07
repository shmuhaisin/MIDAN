import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string; returnTo?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const returnToInvitation = (await searchParams).returnTo === 'invitation';
  if (await getSession()) redirect({ href: returnToInvitation ? '/invitations/accept' : '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'auth' });
  const audience = (await searchParams).as === 'organization' ? 'organization' : 'candidate';
  const org = audience === 'organization';
  return (
    <AuthShell audience={audience} title={t(org ? 'orgLoginTitle' : 'loginTitle')} lead={t(org ? 'orgLoginLead' : 'loginLead')}>
      <LoginForm audience={audience} returnToInvitation={returnToInvitation} />
    </AuthShell>
  );
}
