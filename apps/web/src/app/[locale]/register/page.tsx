import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { RegisterForm } from '@/components/forms';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { getInvitationContext } from '@/lib/invitation-context';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string; returnTo?: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  const context = await getInvitationContext();
  const query = await searchParams;
  const invitation = Boolean(context) || query.returnTo === 'invitation';
  if (await getSession()) redirect({ href: invitation ? '/invitations/accept' : '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'auth' });
  const tm = await getTranslations({ locale, namespace: 'members' });
  const audience = invitation || query.as === 'organization' ? 'organization' : 'candidate';
  const org = audience === 'organization';
  return <AuthShell audience={audience} title={invitation ? tm('registerTitle') : t(org ? 'orgRegisterTitle' : 'registerTitle')} lead={invitation ? tm('registerLead') : t(org ? 'orgRegisterLead' : 'registerLead')}>
    {invitation && !context ? <p role="alert">{tm('missingToken')}</p> : context || process.env.DEV_TEST_SIGNUP === 'true' ? <>
      {!context && <aside className="mb-6 rounded-lg border border-gold bg-surface p-4 text-sm"><p className="font-semibold">{t('devTitle')}</p><p className="mt-1 leading-relaxed">{t('devBody')}</p></aside>}
      <RegisterForm audience={audience} invitation={Boolean(context)} />
    </> : <div><h2 className="font-display text-xl font-semibold">{t('closedTitle')}</h2><p className="mt-2 mb-6 text-muted">{t('closedBody')}</p><Link href={org ? '/login?as=organization' : '/login'} className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('loginSubmit')}</Link></div>}
  </AuthShell>;
}
