'use client';

import { useTranslations } from 'next-intl';
import { StatusScreen } from '@/components/status-screen';
import { Link } from '@/i18n/navigation';

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations();
  return (
    <StatusScreen tone="problem" title={t('errorPage.title')} body={t('errorPage.body')}>
      <button type="button" onClick={reset} className="btn btn-primary btn-lg">{t('errorPage.retry')}</button>
      <Link href="/" className="btn btn-secondary btn-lg">{t('notFound.home')}</Link>
    </StatusScreen>
  );
}
