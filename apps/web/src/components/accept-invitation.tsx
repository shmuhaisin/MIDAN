'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { acceptInvitation, type MemberResult } from '@/lib/member-actions';
import { forgetInvitation, rememberInvitation } from '@/lib/invitation-context-actions';
import { ErrorText, PRIMARY } from './forms';

export function AcceptInvitation({ signedIn, initialExpiresAt }: { signedIn: boolean; initialExpiresAt: number | null }) {
  const t = useTranslations('members'); const router = useRouter();
  const initialized = useRef(false); const sequence = useRef(0);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt); const [ready, setReady] = useState(false);
  const [state, setState] = useState<MemberResult>({}); const [pending, start] = useTransition();
  useEffect(() => {
    async function readInvitation() {
      const current = ++sequence.current;
      // Remove the old tab-storage format; context now lives only in an HttpOnly cookie.
      try { sessionStorage.removeItem('midan_pending_invitation'); } catch {}
      if (location.href.includes('#')) {
        const token = location.hash.slice(1);
        history.replaceState(null, '', location.pathname);
        setReady(false); setExpiresAt(null); setState({});
        try {
          const result = await rememberInvitation(token);
          if (current !== sequence.current) return;
          history.replaceState(null, '', location.pathname);
          setExpiresAt(result.expiresAt ?? null); setState({ error: result.error });
        } catch { if (current === sequence.current) setState({ error: 'unavailable' }); }
      } else if (!initialExpiresAt) {
        await forgetInvitation(0);
      }
      if (current === sequence.current) setReady(true);
    }
    // Strict-mode remount effects must not discard a just-captured fragment.
    if (!initialized.current) { initialized.current = true; void readInvitation(); }
    const changed = () => { void readInvitation(); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [initialExpiresAt]);
  // Cookie mutations can refresh the RSC tree; keep its restored URL token-free.
  useEffect(() => { if (ready) history.replaceState(null, '', location.pathname); }, [ready, expiresAt, initialExpiresAt]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => {
      setExpiresAt(null); setState({ error: 'invitation_unavailable' }); void forgetInvitation(expiresAt);
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return <div className="space-y-5"><p>{t('acceptHelp')}</p>
    {!ready ? <p role="status">{t('working')}</p> : !expiresAt ? (!state.error && <p role="alert">{t('missingToken')}</p>) : signedIn ? (
      <button className={PRIMARY} disabled={pending} aria-busy={pending} onClick={() => start(async () => {
        const result = await acceptInvitation(); setState(result);
        if (result.error === 'invitation_unavailable') setExpiresAt(null);
        if (result.orgId) router.replace(`/organization/${result.orgId}/members`);
      })}>{pending ? t('working') : t('accept')}</button>
    ) : <div className="flex flex-wrap gap-4"><Link className={PRIMARY} href="/login?as=organization&returnTo=invitation">{t('login')}</Link><Link className="inline-flex items-center underline" href="/register?as=organization&returnTo=invitation">{t('register')}</Link></div>}
    <ErrorText code={state.error} />{state.ok && <p role="status">{t('accepted')}</p>}
  </div>;
}
