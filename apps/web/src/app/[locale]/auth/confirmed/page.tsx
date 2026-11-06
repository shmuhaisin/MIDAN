'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Humaidan } from '@/components/brand';
import { Link } from '@/i18n/navigation';

/** Where the verification email lands. Supabase has already confirmed the address by now. */
export default function Page() {
  const t = useTranslations('auth');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Only ever set to true: effects can run twice, and the second run finds the fragment already gone.
    if (params.has('error') || params.has('error_code')) setFailed(true);
    // The link carries session tokens in the fragment. They aren't needed here, so they leave the address bar.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-14 text-center">
      <div className="w-32"><Humaidan sizes="128px" /></div>
      <h1 className="mt-6 page-title">{t(failed ? 'confirmFailedTitle' : 'confirmedTitle')}</h1>
      <p className="mt-3 text-muted">{t(failed ? 'confirmFailedBody' : 'confirmedBody')}</p>
      <Link href="/login" className="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('loginSubmit')}</Link>
    </section>
  );
}
