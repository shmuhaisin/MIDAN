'use client';

// Employer access: the representative's request, and the platform administrator's decision. Every rule is enforced by the
// API and the database; these components only collect input and show the result.
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { decideEmployerAccess, revokeEmployerAccess } from '@/lib/admin-actions';
import { requestEmployerAccess } from '@/lib/actions';
import { ErrorText, Field, INPUT, PRIMARY } from './forms';
import type { SupportedEmployer } from './forms';

export type AccessRequest = {
  id: string; registry_id: string; representative_name: string; job_title: string; work_email: string; phone: string | null;
  verification_note: string | null; source: 'registration' | 'application' | 'invitation'; requested_role: string;
  status: 'pending_approval' | 'approved' | 'rejected' | 'revoked'; org_id: string | null; granted_role: string | null;
  decided_at: string | null; decision_note: string | null; created_at: string;
  employer_name_ar: string | null; employer_name_en: string | null; partnership_status?: string;
  org_name_en?: string | null; org_name_ar?: string | null; org_is_test?: boolean | null; decided_by_email?: string | null;
};

export function EmployerAccessRequestForm({ employers, defaultName }: { employers: SupportedEmployer[]; defaultName: string }) {
  const t = useTranslations('employerAccess');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const result = await requestEmployerAccess(form);
          setError(result.error);
          if (result.ok) router.refresh();
        });
      }}
    >
      <ErrorText code={error} />
      <label className="block">
        <span className="field-label">{t('employer')}</span>
        <select name="registry_id" required defaultValue="" className={INPUT}>
          <option value="" disabled>{t('choose')}</option>
          {employers.map((e) => <option key={e.id} value={e.id}>{(locale === 'ar' ? e.name_ar : e.name_en) ?? e.name_en ?? e.name_ar}</option>)}
        </select>
        <span className="mt-1 block text-xs text-muted">{t('employerHint')}</span>
      </label>
      <Field name="representative_name" required minLength={2} maxLength={200} defaultValue={defaultName} label={t('representative')} />
      <Field name="job_title" required minLength={2} maxLength={200} label={t('jobTitle')} />
      <Field name="phone" type="tel" maxLength={20} dir="ltr" label={t('phone')} />
      <label className="block">
        <span className="field-label">{t('verification')}</span>
        <textarea name="verification_note" rows={3} maxLength={2000} dir="auto" className={clsx(INPUT, 'h-auto py-2.5')} />
        <span className="mt-1 block text-xs text-muted">{t('verificationHint')}</span>
      </label>
      <button type="submit" disabled={pending} aria-busy={pending} className={clsx(PRIMARY, 'w-full')}>{t('submit')}</button>
    </form>
  );
}

export function AccessDecision({ request }: { request: AccessRequest }) {
  const t = useTranslations('employerAccess.admin');
  const [note, setNote] = useState('');
  const [role, setRole] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (request.status === 'approved') {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium">{t('revokeNote')}
          <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={clsx(INPUT, 'h-auto py-2')} />
        </label>
        <button type="button" disabled={pending} onClick={() => start(async () => setError((await revokeEmployerAccess(request.id, note)).error))} className="btn btn-secondary btn-sm">{t('revoke')}</button>
        <ErrorText code={error} />
      </div>
    );
  }
  if (request.status !== 'pending_approval') return null;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">{t('role')}
          <select value={role} onChange={(e) => setRole(e.target.value)} className={INPUT}>
            <option value="">{t('roleDefault')}</option>
            {['owner', 'admin', 'recruiter', 'reviewer'].map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">{t('note')}
          <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={clsx(INPUT, 'h-auto py-2')} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => setError((await decideEmployerAccess(request.id, 'approve', role, note)).error))} className={PRIMARY}>{t('approve')}</button>
        <button type="button" disabled={pending} onClick={() => start(async () => setError((await decideEmployerAccess(request.id, 'reject', '', note)).error))} className="btn btn-secondary btn-sm">{t('reject')}</button>
      </div>
      <ErrorText code={error} />
    </div>
  );
}
