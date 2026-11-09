'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { StatusScreen } from '@/components/status-screen';
import { Link } from '@/i18n/navigation';

/** Where the verification email lands. Supabase has already confirmed the address by now. */
export default function Page() {
  const t = useTranslations('auth');
  const [failed, setFailed] = useState(false);
  const [org, setOrg] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Only ever set to true: effects can run twice, and the second run finds the fragment already gone.
    if (params.has('error') || params.has('error_code')) setFailed(true);
    if (new URLSearchParams(window.location.search).get('as') === 'organization') setOrg(true);
    // The link carries session tokens in the fragment. They aren't needed here, so they leave the address bar.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  return (
    <StatusScreen tone={failed ? 'problem' : 'success'} title={t(failed ? 'confirmFailedTitle' : 'confirmedTitle')} body={t(failed ? 'confirmFailedBody' : 'confirmedBody')}>
      <Link href={org ? '/login?as=organization' : '/login'} className="btn btn-primary btn-lg">{t('loginSubmit')}</Link>
    </StatusScreen>
  );
}
