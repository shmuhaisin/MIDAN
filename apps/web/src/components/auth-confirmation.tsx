'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Humaidan } from '@/components/brand';
import { ErrorText } from '@/components/forms';
import { Link, useRouter } from '@/i18n/navigation';
import { finishInvitationConfirmation } from '@/lib/invitation-context-actions';

/** Decoded metadata steers presentation only; the server verifies Auth and invitation. */
function metadata(token: string | null): { account_type?: string; invitation_signup?: boolean } {
  try {
    const payload = token?.split('.')[1]; if (!payload) return {};
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)).user_metadata ?? {};
  } catch { return {}; }
}
export function AuthConfirmation({ invitationContext }: { invitationContext: boolean }) {
  const t = useTranslations('auth'); const tm = useTranslations('members'); const router = useRouter();
  const processed = useRef(false);
  const [failed, setFailed] = useState(false); const [org, setOrg] = useState(invitationContext);
  const [invitation, setInvitation] = useState(invitationContext); const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false); const [error, setError] = useState<string>();
  useEffect(() => {
    if (processed.current) return; processed.current = true;
    const params = new URLSearchParams(location.hash.slice(1));
    const query = new URLSearchParams(location.search);
    const access = params.get('access_token'); const refresh = params.get('refresh_token');
    const meta = metadata(access);
    const invited = invitationContext || meta.invitation_signup === true;
    const invalid = params.has('error') || params.has('error_code') || query.has('error') || query.has('error_code');
    // Clear tokens before any network/navigation operation. Never log the fragment.
    history.replaceState(null, '', location.pathname);
    setInvitation(invited); setOrg(invited || meta.account_type === 'organization'); setFailed(invalid); setReady(true);
    if (!invited || invalid) return;
    setWorking(true);
    void finishInvitationConfirmation(access ?? undefined, refresh ?? undefined).then(result => {
      if (result.ok) router.replace('/invitations/accept');
      else if (result.login) router.replace('/login?as=organization&returnTo=invitation');
      else setError(result.error);
    }).catch(() => setError('unavailable')).finally(() => setWorking(false));
  }, [invitationContext, router]);
  return <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-14 text-center">
    {ready && !org && <div className="w-32"><Humaidan sizes="128px" /></div>}
    <h1 className={ready && !org ? 'mt-6 font-display text-3xl font-bold' : 'font-display text-3xl font-bold'}>{error ? tm('confirmationIssue') : t(failed ? 'confirmFailedTitle' : 'confirmedTitle')}</h1>
    <p className="mt-3 text-lg text-muted">{t(failed ? 'confirmFailedBody' : 'confirmedBody')}</p>
    {working && <p role="status">{tm('working')}</p>}<ErrorText code={error} />
    {!working && <Link href={invitation ? '/login?as=organization&returnTo=invitation' : org ? '/login?as=organization' : '/login'} className="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('loginSubmit')}</Link>}
  </section>;
}
