'use client';

// Organization review screens: the employer's application (profile, documents, submission, decisions) and the platform
// administrator's decision controls. Rules mirror lib/verification.ts; the API and database enforce them.
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useId, useRef, useState, useTransition } from 'react';
import type { FormState } from '@/lib/auth-actions';
import { formatWhen, intlLocale } from '@/lib/format';
import {
  adminOrganizationDocumentLink, decideOrganization, organizationDocumentLink, removeOrganizationDocument, saveOrganizationProfile,
  setOrganizationSuspension, submitOrganizationForReview, uploadOrganizationDocument,
} from '@/lib/verification-actions';
import {
  DOCUMENT_KINDS, identityLocked, isEditable, missingForReview, STATUS_TONE, type OrganizationDocument, type ReviewRequest, type ReviewStatus, type VerificationState,
} from '@/lib/verification';
import { ActionForm, ErrorText, Field, INPUT, openFileLink, PRIMARY, Submit } from './forms';
import { Icon } from './icons';
import { Badge } from './ui';

const COMPANY_TYPES = ['private_company', 'startup', 'sme', 'large_enterprise', 'government_entity', 'semi_government', 'nonprofit', 'multinational'];
const INDUSTRIES = ['general', 'finance', 'legal', 'engineering', 'technology', 'events', 'healthcare', 'media', 'marketing'];

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const t = useTranslations('verification.status');
  return <Badge tone={STATUS_TONE[status]}>{t(status)}</Badge>;
}

/** Profile → documents → submit → decision, with where the organization is now. */
function Steps({ state }: { state: VerificationState }) {
  const t = useTranslations('verification.steps');
  const status = state.organization.verification_status;
  const missing = missingForReview(state);
  const profileDone = !missing.some((m) => !m.startsWith('document_'));
  const docsDone = !missing.includes('document_commercial_registration');
  const submitted = !isEditable(status);
  const steps = [
    { key: 'profile', done: profileDone || submitted },
    { key: 'documents', done: docsDone || submitted },
    { key: 'submit', done: submitted },
    { key: 'decision', done: status === 'approved' || status === 'suspended' },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-border bg-border sm:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.key} aria-current={i === current ? 'step' : undefined} className={clsx('flex items-center gap-3 bg-surface px-4 py-3 text-sm', i === current && 'bg-mint/10')}>
          <span aria-hidden className={clsx('grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
            s.done ? 'border-primary bg-primary text-primary-foreground' : i === current ? 'border-primary text-primary' : 'border-border-strong text-muted')}>
            {s.done ? <Icon name="check" className="size-3.5" /> : i + 1}
          </span>
          <span className={clsx(i === current ? 'font-semibold' : 'text-muted', s.done && 'text-foreground')}>{t(s.key)}</span>
        </li>
      ))}
    </ol>
  );
}

function StatusPanel({ state }: { state: VerificationState }) {
  const t = useTranslations('verification');
  const locale = useLocale();
  const { verification_status: status, verification_updated_at: at } = state.organization;
  const latest = state.requests[0];
  const note = latest && (latest.status === 'changes_requested' || latest.status === 'rejected') ? latest.decision_note : null;
  return (
    <section aria-labelledby="review-status" className={clsx('card space-y-3 border-s-4',
      status === 'approved' ? 'border-s-primary' : status === 'rejected' || status === 'suspended' ? 'border-s-error' : 'border-s-brand-gold')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-status" className="subsection-title">{t('statusHeading')}</h2>
        <ReviewStatusBadge status={status} />
      </div>
      <p className="leading-relaxed">{t(`statusBody.${status}`)}</p>
      {note && (
        <div className="rounded-[var(--radius-control)] bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted">{t(latest.status === 'rejected' ? 'rejectionReason' : 'requestedChanges')}</p>
          <p dir="auto" className="mt-1 whitespace-pre-line">{note}</p>
        </div>
      )}
      {at && <p className="text-xs text-muted">{t('updatedAt', { when: formatWhen(locale, at, 'Asia/Riyadh') })}</p>}
    </section>
  );
}

function Select({ name, label, options, value, labelFor, disabled }: { name: string; label: string; options: string[]; value: string | null; labelFor: (v: string) => string; disabled?: boolean }) {
  const id = useId();
  const t = useTranslations('verification');
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <select id={id} name={name} defaultValue={value ?? ''} disabled={disabled} className={INPUT}>
        <option value="">{t('choose')}</option>
        {options.map((o) => <option key={o} value={o}>{labelFor(o)}</option>)}
      </select>
    </div>
  );
}

function Area({ name, label, value, dir, disabled }: { name: string; label: string; value: string | null; dir: 'rtl' | 'ltr'; disabled?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <textarea id={id} name={name} rows={4} maxLength={4000} dir={dir} defaultValue={value ?? ''} disabled={disabled} className={clsx(INPUT, 'h-auto py-2.5 leading-relaxed')} />
    </div>
  );
}

function ProfileForm({ orgId, state, canManage }: { orgId: string; state: VerificationState; canManage: boolean }) {
  const t = useTranslations('verification');
  const tc = useTranslations('assessmentIntel.companyTypes');
  const tf = useTranslations('fields');
  const o = state.organization;
  const locked = identityLocked(o.verification_status);
  const [result, action] = useActionState<FormState, FormData>(saveOrganizationProfile.bind(null, orgId), {});
  const off = !canManage;
  return (
    <section aria-labelledby="org-profile" className="card space-y-5">
      <div>
        <h2 id="org-profile" className="subsection-title">{t('profileHeading')}</h2>
        <p className="mt-1 text-sm text-muted">{t(locked ? 'identityLocked' : 'profileLead')}</p>
      </div>
      <ActionForm action={action} className="space-y-6">
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={off}>
          <legend className="label-caps mb-3 sm:col-span-2">{t('identity')}</legend>
          {/* Disabled fields aren't sent, so locked values can't be changed from here. */}
          <Field name="name_ar" label={t('field.name_ar')} defaultValue={o.name_ar} dir="rtl" required maxLength={200} disabled={locked || off} />
          <Field name="name_en" label={t('field.name_en')} defaultValue={o.name_en} dir="ltr" required maxLength={200} disabled={locked || off} />
          <Field name="commercial_registration" label={t('field.commercial_registration')} hint={t('crHint')} defaultValue={o.commercial_registration ?? ''}
            inputMode="numeric" pattern="[0-9 ]{10,13}" dir="ltr" disabled={locked || off} />
          <Select name="company_type" label={t('field.company_type')} options={COMPANY_TYPES} value={o.company_type} labelFor={(v) => tc(v)} disabled={off} />
          <Select name="industry" label={t('field.industry')} options={INDUSTRIES} value={o.industry} labelFor={(v) => tf(v)} disabled={off} />
          <Field name="city" label={t('field.city')} defaultValue={o.city ?? ''} maxLength={100} disabled={off} />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={off}>
          <legend className="label-caps mb-3 sm:col-span-2">{t('contact')}</legend>
          <Field name="business_email" type="email" label={t('field.business_email')} defaultValue={o.business_email ?? ''} dir="ltr" maxLength={200} />
          <Field name="contact_phone" type="tel" label={t('field.contact_phone')} hint={t('phoneHint')} defaultValue={o.contact_phone ?? ''} dir="ltr" maxLength={20} />
          <Field name="website" type="url" label={t('field.website')} hint={t('websiteHint')} defaultValue={o.website ?? ''} dir="ltr" maxLength={300} />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={off}>
          <legend className="label-caps mb-3 sm:col-span-2">{t('representative')}</legend>
          <Field name="representative_name" label={t('field.representative_name')} defaultValue={o.representative_name ?? ''} maxLength={200} />
          <Field name="representative_title" label={t('field.representative_title')} defaultValue={o.representative_title ?? ''} maxLength={200} />
        </fieldset>
        <fieldset className="grid gap-4 lg:grid-cols-2" disabled={off}>
          <legend className="label-caps mb-3 lg:col-span-2">{t('about')}</legend>
          <Area name="description_ar" label={t('field.description_ar')} value={o.description_ar} dir="rtl" />
          <Area name="description_en" label={t('field.description_en')} value={o.description_en} dir="ltr" />
        </fieldset>
        {canManage && (
          <div className="flex flex-wrap items-center gap-4">
            <Submit>{t('saveProfile')}</Submit>
            {result.ok && <p role="status" className="text-sm text-primary">{t('saved')}</p>}
            <ErrorText code={result.error} />
          </div>
        )}
      </ActionForm>
    </section>
  );
}

function size(bytes: number, locale: string) {
  const kb = bytes / 1024;
  // A file under a kilobyte would otherwise read "0 KB".
  if (kb < 1) return `<${new Intl.NumberFormat(intlLocale(locale)).format(1)} KB`;
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: kb >= 1024 ? 1 : 0 }).format(kb >= 1024 ? kb / 1024 : kb) + (kb >= 1024 ? ' MB' : ' KB');
}

export function DocumentList({ documents, open, remove }: {
  documents: OrganizationDocument[]; open: (id: string) => Promise<{ url?: string; error?: string }>; remove?: (id: string) => Promise<FormState>;
}) {
  const t = useTranslations('verification');
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (documents.length === 0) return <p className="text-sm text-muted">{t('noDocuments')}</p>;
  return (
    <>
      <ul className="divide-y divide-border rounded-[var(--radius-control)] border border-border">
        {documents.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Icon name="file" className="size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t(`kind.${d.kind}`)}</p>
              <p className="truncate text-xs text-muted" dir="auto">{d.file_name} · {size(d.size_bytes, locale)} · {formatWhen(locale, d.created_at, 'Asia/Riyadh')}</p>
            </div>
            <button type="button" className="link text-sm" disabled={pending} onClick={() => start(() => openFileLink(() => open(d.id), setError))}>{t('open')}</button>
            {remove && (
              <button type="button" className="link text-sm text-error" disabled={pending} onClick={() => start(async () => setError((await remove(d.id)).error))}>
                {t('remove')}<span className="sr-only"> {t(`kind.${d.kind}`)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText code={error} />
    </>
  );
}

function Documents({ orgId, state, canManage }: { orgId: string; state: VerificationState; canManage: boolean }) {
  const t = useTranslations('verification');
  const editable = canManage && isEditable(state.organization.verification_status);
  const kindId = useId();
  const fileId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const upload = (form: FormData) => start(async () => {
    const result = await uploadOrganizationDocument(orgId, form);
    setError(result.error);
    if (result.ok) formRef.current?.reset();
  });
  return (
    <section aria-labelledby="org-documents" className="card space-y-4">
      <div>
        <h2 id="org-documents" className="subsection-title">{t('documentsHeading')}</h2>
        <p className="mt-1 text-sm text-muted">{t(editable ? 'documentsLead' : 'documentsLocked')}</p>
      </div>
      <DocumentList documents={state.documents} open={(id) => organizationDocumentLink(orgId, id)} remove={editable ? (id) => removeOrganizationDocument(orgId, id) : undefined} />
      {editable && (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); upload(new FormData(e.currentTarget)); }} className="grid gap-4 border-t border-border pt-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor={kindId} className="field-label">{t('documentKind')}</label>
            <select id={kindId} name="kind" defaultValue="commercial_registration" className={INPUT}>
              {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={fileId} className="field-label">{t('file')}</label>
            <input id={fileId} name="file" type="file" required accept="application/pdf,image/png,image/jpeg" aria-describedby={`${fileId}-hint`} className={clsx(INPUT, 'py-1.5')} />
            <p id={`${fileId}-hint`} className="mt-1 text-xs text-muted">{t('fileHint')}</p>
          </div>
          <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-secondary">{t('upload')}</button>
          <div className="sm:col-span-3"><ErrorText code={error} /></div>
        </form>
      )}
    </section>
  );
}

function SubmitPanel({ orgId, state }: { orgId: string; state: VerificationState }) {
  const t = useTranslations('verification');
  const missing = missingForReview(state);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const resubmission = state.organization.verification_status !== 'draft';
  return (
    <section aria-labelledby="org-submit" className="card space-y-4">
      <h2 id="org-submit" className="subsection-title">{t(resubmission ? 'resubmitHeading' : 'submitHeading')}</h2>
      {missing.length > 0 ? (
        <>
          <p className="text-sm">{t('missingLead')}</p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {missing.map((m) => (
              <li key={m} className="flex items-center gap-2"><span aria-hidden className="size-1.5 rounded-full bg-brand-gold" />{t(`missing.${m}`)}</li>
            ))}
          </ul>
        </>
      ) : <p className="text-sm">{t('readyLead')}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={pending || missing.length > 0} aria-busy={pending} className={PRIMARY}
          onClick={() => start(async () => setError((await submitOrganizationForReview(orgId)).error))}>
          {t(resubmission ? 'resubmit' : 'submit')}
        </button>
        <p className="text-xs text-muted">{t('submitNote')}</p>
      </div>
      <ErrorText code={error} />
    </section>
  );
}

export function ReviewHistory({ requests, showPeople = false }: { requests: ReviewRequest[]; showPeople?: boolean }) {
  const t = useTranslations('verification');
  const locale = useLocale();
  if (requests.length === 0) return <p className="text-sm text-muted">{t('noHistory')}</p>;
  return (
    <ol className="space-y-4 border-s border-border ps-5">
      {requests.map((r) => (
        <li key={r.id} className="relative">
          <span aria-hidden className={clsx('absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full border-2 border-surface',
            r.status === 'approved' ? 'bg-primary' : r.status === 'pending_review' ? 'bg-brand-gold' : 'bg-error')} />
          <div className="flex flex-wrap items-center gap-2">
            <ReviewStatusBadge status={r.status as ReviewStatus} />
            <span className="text-sm text-muted">{t('submittedAt', { when: formatWhen(locale, r.created_at, 'Asia/Riyadh') })}</span>
            {showPeople && r.submitted_by_email && <span className="text-xs text-muted" dir="ltr">{r.submitted_by_email}</span>}
          </div>
          {r.reviewed_at && (
            <p className="mt-1 text-sm text-muted">
              {t('decidedAt', { when: formatWhen(locale, r.reviewed_at, 'Asia/Riyadh') })}
              {showPeople && r.reviewed_by_email && <span dir="ltr"> · {r.reviewed_by_email}</span>}
            </p>
          )}
          {r.decision_note && <p dir="auto" className="mt-1 whitespace-pre-line text-sm">{r.decision_note}</p>}
          <p className="mt-1 text-xs text-muted">{t('documentsAtSubmission', { count: r.snapshot.documents?.length ?? 0 })}</p>
        </li>
      ))}
    </ol>
  );
}

/** The employer's page: where the application stands, what to complete, and every decision so far. */
export function OrganizationReview({ orgId, state, canManage }: { orgId: string; state: VerificationState; canManage: boolean }) {
  const t = useTranslations('verification');
  const status = state.organization.verification_status;
  return (
    <div className="space-y-6">
      <Steps state={state} />
      <StatusPanel state={state} />
      {!canManage && <p className="callout text-sm">{t('ownersOnly')}</p>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <ProfileForm orgId={orgId} state={state} canManage={canManage} />
          <Documents orgId={orgId} state={state} canManage={canManage} />
          {canManage && isEditable(status) && <SubmitPanel orgId={orgId} state={state} />}
        </div>
        <aside aria-labelledby="org-history" className="card h-fit space-y-4 xl:sticky xl:top-24">
          <h2 id="org-history" className="subsection-title">{t('historyHeading')}</h2>
          <ReviewHistory requests={state.requests} />
        </aside>
      </div>
    </div>
  );
}

// Platform administrators -------------------------------------------------------------------------------------------

export function AdminDocumentList({ id, documents }: { id: string; documents: OrganizationDocument[] }) {
  return <DocumentList documents={documents} open={(docId) => adminOrganizationDocumentLink(id, docId)} />;
}

/** Decide a waiting application, or suspend / reactivate. Refusals and suspensions need a reason, which is recorded. */
export function AdminOrganizationActions({ id, status }: { id: string; status: ReviewStatus }) {
  const t = useTranslations('admin.organizations');
  const noteId = useId();
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const act = (key: string, work: () => Promise<FormState>) => start(async () => {
    const result = await work();
    setError(result.error);
    if (result.ok) { setDone(key); setNote(''); }
  });
  const decision = status === 'pending_review';
  const suspension = status === 'approved' || status === 'suspended';
  if (!decision && !suspension) return <p className="text-sm text-muted">{t(`nothingToDecide.${status}`)}</p>;
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={noteId} className="field-label">{t(decision ? 'note' : 'reason')}</label>
        <textarea id={noteId} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${noteId}-hint`}
          className={clsx(INPUT, 'h-auto py-2')} dir="auto" />
        <p id={`${noteId}-hint`} className="mt-1 text-xs text-muted">{t(decision ? 'noteHint' : 'reasonHint')}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {decision && (
          <>
            <button type="button" disabled={pending} className={PRIMARY} onClick={() => act('approved', () => decideOrganization(id, 'approve', note))}>{t('approve')}</button>
            <button type="button" disabled={pending} className="btn btn-secondary" onClick={() => act('changes', () => decideOrganization(id, 'request_changes', note))}>{t('requestChanges')}</button>
            <button type="button" disabled={pending} className="btn btn-danger" onClick={() => act('rejected', () => decideOrganization(id, 'reject', note))}>{t('reject')}</button>
          </>
        )}
        {status === 'approved' && <button type="button" disabled={pending} className="btn btn-danger" onClick={() => act('suspended', () => setOrganizationSuspension(id, true, note))}>{t('suspend')}</button>}
        {status === 'suspended' && <button type="button" disabled={pending} className={PRIMARY} onClick={() => act('reactivated', () => setOrganizationSuspension(id, false, note))}>{t('reactivate')}</button>}
      </div>
      {done && <p role="status" className="text-sm text-primary">{t(`done.${done}`)}</p>}
      <ErrorText code={error} />
    </div>
  );
}
