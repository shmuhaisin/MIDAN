import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ConfirmationResend } from '@/components/confirmation-resend';
import { StatusScreen } from '@/components/status-screen';
import { Link } from '@/i18n/navigation';
import { getPendingEmail } from '@/lib/session';

/**
 * After registration: the address the email went to (from the sign-up itself, kept server-side), a way to ask for it
 * again after a short wait, and sign-in for when the link has been used.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  const organization = (await searchParams).as === 'organization';
  const email = await getPendingEmail();
  return (
    <StatusScreen
      title={t('checkTitle')}
      body={email ? t.rich('checkBodyTo', { email: () => <bdi dir="ltr" className="font-semibold text-foreground">{email}</bdi> }) : t('checkBody')}
      note={t('checkNote')}
    >
      <ConfirmationResend organization={organization} email={email} />
      <p className="border-t border-border pt-4 text-sm text-muted">
        {t('alreadyConfirmed')} <Link href={organization ? '/login?as=organization' : '/login'} className="link">{t('loginSubmit')}</Link>
      </p>
    </StatusScreen>
  );
}
