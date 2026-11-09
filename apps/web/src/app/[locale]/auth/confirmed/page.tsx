'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { StatusScreen } from '@/components/status-screen';
import { Link, useRouter } from '@/i18n/navigation';
import { continueFromEmailLink } from '@/lib/auth-actions';

/**
 * Where the verification email lands. Supabase has already confirmed the address and signed the person in; the session
 * travels in the fragment. It is carried into the app's cookies (checked by Auth on the server), and the person goes
 * straight to their workspace or onboarding. If that can't be done, they sign in as before.
 */
export default function Page() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [state, setState] = useState<'continuing' | 'confirmed' | 'failed'>('continuing');
  const [org, setOrg] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Effects can run twice in development; the fragment is read and cleared once.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    setOrg(new URLSearchParams(window.location.search).get('as') === 'organization');
    // The tokens leave the address bar at once, whatever happens next.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (params.has('error') || params.has('error_code')) return setState('failed');
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) return setState('confirmed');
    continueFromEmailLink(access, refresh)
      .then((result) => (result.href ? router.replace(result.href) : setState('confirmed')))
      .catch(() => setState('confirmed'));
  }, [router]);

  if (state === 'continuing') {
    return (
      <StatusScreen tone="success" title={t('confirmedTitle')} body={t('confirmedContinuing')}>
        <span role="status" aria-live="polite" className="inline-flex items-center gap-3 text-sm text-muted">
          <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />
          {t('confirmedContinuingShort')}
        </span>
      </StatusScreen>
    );
  }
  const failed = state === 'failed';
  return (
    <StatusScreen tone={failed ? 'problem' : 'success'} title={t(failed ? 'confirmFailedTitle' : 'confirmedTitle')} body={t(failed ? 'confirmFailedBody' : 'confirmedBody')}>
      <Link href={org ? '/login?as=organization' : '/login'} className="btn btn-primary btn-lg">{t('loginSubmit')}</Link>
    </StatusScreen>
  );
}
