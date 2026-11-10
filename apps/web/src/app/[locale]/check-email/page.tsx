import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatusScreen } from '@/components/status-screen';
import { Link } from '@/i18n/navigation';
import { ConfirmationResend } from '@/components/confirmation-resend';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const organization = (await searchParams).as === 'organization';
  return (
    <StatusScreen title={t('auth.checkTitle')} body={t('auth.checkBody')} note={t('auth.checkNote')}>
      <ConfirmationResend organization={organization} />
      <Link href={organization ? '/login?as=organization' : '/login'} className="btn btn-secondary btn-lg">{t('nav.login')}</Link>
    </StatusScreen>
  );
}
