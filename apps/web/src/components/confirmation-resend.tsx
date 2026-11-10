'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { resendConfirmation, type FormState } from '@/lib/auth-actions';
import { ActionForm, ErrorText, Field, Submit } from './forms';

export function ConfirmationResend({ organization = false }: { organization?: boolean }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(resendConfirmation, {});
  const [remaining, setRemaining] = useState(0);
  useEffect(() => { setRemaining(state.retryAfter ?? 0); }, [state]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return (
    <ActionForm action={action} className="w-full max-w-md space-y-4 text-start">
      <input type="hidden" name="account_type" value={organization ? 'organization' : 'candidate'} />
      <Field name="email" type="email" autoComplete="email" required maxLength={320} label={t('email')} dir="ltr" />
      <ErrorText code={state.error} />
      {state.ok && <p role="status" className="text-sm text-muted">{t('resendAccepted')}</p>}
      <fieldset disabled={remaining > 0}>
        <Submit>{t('resendConfirmation')}</Submit>
      </fieldset>
      {remaining > 0 && <p role="status" className="text-sm text-muted">{t('resendWait', { seconds: remaining })}</p>}
    </ActionForm>
  );
}
