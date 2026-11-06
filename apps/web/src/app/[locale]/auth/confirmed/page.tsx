'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Humaidan } from '@/components/brand';
import { Link } from '@/i18n/navigation';

/** The confirmation link may carry a session token. Read only the account type, then drop the fragment. */
function organizationConfirmation(hash: string) {
  const token = new URLSearchParams(hash.slice(1)).get('access_token');
  const payload = token?.split('.')[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { user_metadata?: { account_type?: string } };
    return claims.user_metadata?.account_type === 'organization';
  } catch {
    return false;
  }
}

/** Where the verification email lands. Supabase has already confirmed the address by now. */
export default function Page() {
  const t = useTranslations('auth');
  const [failed, setFailed] = useState(false);
  const [org, setOrg] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Only ever set to true: effects can run twice, and the second run finds the fragment already gone.
    if (params.has('error') || params.has('error_code')) setFailed(true);
    else if (organizationConfirmation(window.location.hash)) setOrg(true);
    // The link carries session tokens in the fragment. They aren't needed here, so they leave the address bar.
    window.history.replaceState(null, '', window.location.pathname);
    setReady(true);
  }, []);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-14 text-center">
      {ready && !org && <div className="w-32"><Humaidan sizes="128px" /></div>}
      <h1 className={ready && !org ? 'mt-6 font-display text-3xl font-bold' : 'font-display text-3xl font-bold'}>{t(failed ? 'confirmFailedTitle' : 'confirmedTitle')}</h1>
      <p className="mt-3 text-lg text-muted">{t(failed ? 'confirmFailedBody' : 'confirmedBody')}</p>
      <Link href={org ? '/login?as=organization' : '/login'} className="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('loginSubmit')}</Link>
    </section>
  );
}
