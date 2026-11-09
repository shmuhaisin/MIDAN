import { useTranslations } from 'next-intl';
import { StatusScreen } from '@/components/status-screen';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations();
  return (
    <StatusScreen code="404" title={t('notFound.title')} body={t('notFound.body')}>
      <Link href="/" className="btn btn-primary btn-lg">{t('notFound.home')}</Link>
      <Link href="/opportunities" className="btn btn-secondary btn-lg">{t('nav.opportunities')}</Link>
    </StatusScreen>
  );
}
