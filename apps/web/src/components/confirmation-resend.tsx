'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { resendConfirmation, type FormState } from '@/lib/auth-actions';
import { ActionForm, ErrorText, Field, Submit } from './forms';

/** How long after sign-up before another email can be asked for: the first one was just requested. */
const FIRST_WAIT = 30;

/**
 * Asking for the confirmation email again. With the address just registered (`email`), it's shown and used as is; a
 * person who arrived some other way types theirs. The wait between requests comes from the server, so the countdown is
 * honest, and "requested" never claims the email arrived.
 */
export function ConfirmationResend({ organization = false, email }: { organization?: boolean; email?: string | null }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(resendConfirmation, {});
  const [remaining, setRemaining] = useState(email ? FIRST_WAIT : 0);
  const [other, setOther] = useState(!email);
  useEffect(() => { if (state.retryAfter !== undefined) setRemaining(state.retryAfter); }, [state]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return (
    <ActionForm action={action} className="space-y-3 text-start">
      <input type="hidden" name="account_type" value={organization ? 'organization' : 'candidate'} />
      {other
        ? <Field name="email" type="email" autoComplete="email" required maxLength={320} label={t('email')} dir="ltr" />
        : <input type="hidden" name="email" value={email ?? ''} />}
      <ErrorText code={state.error} />
      {state.ok && <p role="status" className="text-sm text-muted">{t('resendAccepted')}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset disabled={remaining > 0}>
          <Submit className="btn-sm">{t('resendConfirmation')}</Submit>
        </fieldset>
        {remaining > 0 && <p role="status" className="num text-sm text-muted">{t('resendWait', { seconds: remaining })}</p>}
        {email && !other && <button type="button" onClick={() => setOther(true)} className="link text-sm">{t('resendOtherAddress')}</button>}
      </div>
    </ActionForm>
  );
}
