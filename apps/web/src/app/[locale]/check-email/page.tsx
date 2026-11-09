import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatusScreen } from '@/components/status-screen';
import { Link } from '@/i18n/navigation';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <StatusScreen title={t('auth.checkTitle')} body={t('auth.checkBody')} note={t('auth.checkNote')}>
      <Link href="/login" className="btn btn-primary btn-lg">{t('nav.login')}</Link>
    </StatusScreen>
  );
}
