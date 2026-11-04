'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Link } from '@/i18n/navigation';
import { applyToJob, createJob, createOrganization, saveProfile, setApplicationStatus, setJobStatus, withdrawApplication } from '@/lib/actions';
import { signIn, signUp, type FormState } from '@/lib/auth-actions';
import { Arrow } from './brand';

const INPUT = 'mt-1.5 block h-12 w-full rounded-lg border border-border bg-surface px-3.5 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25';
const PRIMARY = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-60';

function Submit({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={clsx(PRIMARY, className)}>
      {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
      {children}
    </button>
  );
}

function ErrorText({ code }: { code?: string }) {
  const t = useTranslations('errors');
  return (
    <AnimatePresence>
      {code && (
        <motion.p
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="rounded-lg border-s-2 border-error bg-surface-2 px-3.5 py-2.5 text-sm"
        >
          {t(code)}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function Field({ label, hint, name, ...props }: { label: string; hint?: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input name={name} aria-describedby={hint ? `${name}-hint` : undefined} className={INPUT} {...props} />
      {hint && <span id={`${name}-hint`} className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function LoginForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <ErrorText code={state.error} />
      <Field name="email" type="email" autoComplete="email" required label={t('email')} dir="ltr" />
      <Field name="password" type="password" autoComplete="current-password" required label={t('password')} dir="ltr" />
      <Submit className="w-full">{t('loginSubmit')}</Submit>
      <p className="text-center text-sm text-muted">
        {t('noAccount')} <Link href="/register" className="font-semibold text-primary underline underline-offset-4">{t('registerSubmit')}</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ initialType }: { initialType: 'candidate' | 'organization' }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const [type, setType] = useState(initialType);
  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium">{t('accountType')}</legend>
        <div className="mt-1.5 grid grid-cols-2 rounded-full border border-border p-1">
          {(['candidate', 'organization'] as const).map((k) => (
            <label key={k} className="relative cursor-pointer rounded-full py-2 text-center text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary">
              <input type="radio" name="account_type" value={k} checked={type === k} onChange={() => setType(k)} className="sr-only" />
              {type === k && <motion.span layoutId="account-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ duration: 0.2 }} />}
              <span className={clsx('relative', type === k ? 'text-primary-foreground' : 'text-muted')}>{t(k)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorText code={state.error} />
      <Field name="display_name" autoComplete="name" required maxLength={200} label={t('displayName')} />
      <Field name="email" type="email" autoComplete="email" required label={t('email')} dir="ltr" />
      <Field name="password" type="password" autoComplete="new-password" required minLength={8} label={t('password')} hint={t('passwordHint')} dir="ltr" />
      <Submit className="w-full">{t('registerSubmit')}</Submit>
      <p className="text-center text-sm text-muted">
        {t('haveAccount')} <Link href="/login" className="font-semibold text-primary underline underline-offset-4">{t('loginSubmit')}</Link>
      </p>
    </form>
  );
}

export function ProfileForm({ profile }: { profile: { full_name?: string; headline?: string | null; city?: string | null; share_profile_consent?: boolean } | null }) {
  const t = useTranslations('profile');
  const [state, action] = useActionState<FormState, FormData>(saveProfile, {});
  return (
    <form action={action} className="space-y-4">
      <ErrorText code={state.error} />
      <Field name="full_name" required maxLength={200} autoComplete="name" defaultValue={profile?.full_name ?? ''} label={t('fullName')} />
      <Field name="headline" maxLength={200} defaultValue={profile?.headline ?? ''} label={t('headline')} hint={t('headlineHint')} />
      <Field name="city" maxLength={100} defaultValue={profile?.city ?? ''} label={t('city')} />
      <label className="flex items-start gap-3 rounded-lg bg-surface p-4">
        <input type="checkbox" name="share_profile_consent" defaultChecked={profile?.share_profile_consent ?? false} className="mt-1 size-4 accent-[var(--primary)]" />
        <span>
          <span className="block text-sm font-medium">{t('consent')}</span>
          <span className="mt-1 block text-xs text-muted">{t('consentHint')}</span>
        </span>
      </label>
      <div className="flex items-center gap-4">
        <Submit>{t('save')}</Submit>
        {state.ok && <motion.span role="status" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="font-semibold text-primary">{t('saved')}</motion.span>}
      </div>
    </form>
  );
}

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function OrganizationForm() {
  const t = useTranslations('org');
  const [state, action] = useActionState<FormState, FormData>(createOrganization, {});
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <ErrorText code={state.error} />
      <Field name="name_ar" required maxLength={200} label={t('nameAr')} dir="rtl" />
      <Field name="name_en" required maxLength={200} label={t('nameEn')} dir="ltr" onChange={(e) => !edited && setSlug(toSlug(e.target.value))} />
      <Field name="slug" required maxLength={80} label={t('slug')} hint={t('slugHint')} dir="ltr" value={slug} onChange={(e) => { setEdited(true); setSlug(e.target.value); }} />
      <Submit>{t('create')}<Arrow /></Submit>
    </form>
  );
}

export function JobForm({ orgId }: { orgId: string }) {
  const t = useTranslations('org');
  const [state, action, pending] = useActionState<FormState, FormData>(createJob.bind(null, orgId), {});
  const [slug, setSlug] = useState('');
  const [open, setOpen] = useState(false);
  const [wasPending, setWasPending] = useState(false);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending && state.ok) { setOpen(false); setSlug(''); }
  }
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-2">
        <span aria-hidden className={clsx('transition-transform', open && 'rotate-45')}>+</span>{t('addJob')}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <form action={action} className="mt-4 grid gap-4 rounded-lg bg-surface p-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><ErrorText code={state.error} /></div>
              <Field name="title_ar" required maxLength={200} label={t('titleAr')} dir="rtl" />
              <Field name="title_en" required maxLength={200} label={t('titleEn')} dir="ltr" onChange={(e) => setSlug(toSlug(e.target.value))} />
              <Field name="slug" required maxLength={80} label={t('jobSlug')} hint={t('slugHint')} dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <div className="flex items-start pt-6"><Submit>{t('createJob')}</Submit></div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function useAction(run: () => Promise<FormState>) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return { pending, error, fire: () => start(async () => setError((await run()).error)) };
}

export function JobStatusButtons({ orgId, jobId, status }: { orgId: string; jobId: string; status: string }) {
  const t = useTranslations('org');
  const [target, setTarget] = useState(status);
  const { pending, error, fire } = useAction(() => setJobStatus(orgId, jobId, target));
  useEffect(() => { if (target !== status && !pending) fire(); }, [target]); // eslint-disable-line
  const actions = status === 'published' ? [['draft', 'unpublish'], ['closed', 'close']] : [['published', 'publish']];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map(([value, label]) => (
        <button key={value} type="button" disabled={pending} onClick={() => setTarget(value)}
          className={clsx('rounded-full px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60', value === 'published' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-surface-2')}>
          {t(label)}
        </button>
      ))}
      <ErrorText code={error} />
    </div>
  );
}

const ORG_STATUSES = ['submitted', 'under_review', 'assessment_invited', 'shortlisted', 'rejected', 'hired'];

export function ApplicantStatus({ id, status, label }: { id: string; status: string; label: string }) {
  const t = useTranslations('applicationStatus');
  const [pending, start] = useTransition();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string>();
  const options = ORG_STATUSES.includes(status) ? ORG_STATUSES : [status, ...ORG_STATUSES];
  return (
    <div>
      <select
        aria-label={label}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          start(async () => {
            const result = await setApplicationStatus(id, next);
            setError(result.error);
            if (result.error) setValue(status);
          });
        }}
        className="h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-sm disabled:opacity-60"
      >
        {options.map((s) => <option key={s} value={s}>{t(s)}</option>)}
      </select>
      <ErrorText code={error} />
    </div>
  );
}

export function ApplyButton({ jobId }: { jobId: string }) {
  const t = useTranslations('jobs');
  const { pending, error, fire } = useAction(() => applyToJob(jobId));
  return (
    <div className="space-y-3">
      <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className={PRIMARY}>
        {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
        {t('apply')}<Arrow />
      </button>
      <ErrorText code={error} />
    </div>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const t = useTranslations('dashboard');
  const [confirming, setConfirming] = useState(false);
  const { pending, error, fire } = useAction(() => withdrawApplication(id));
  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted underline underline-offset-4 hover:text-foreground">{t('withdraw')}</button>;
  }
  return (
    <div role="alertdialog" aria-label={t('withdraw')} className="mt-2 rounded-lg bg-surface-2 p-3 text-sm">
      <p>{t('withdrawConfirm')}</p>
      <div className="mt-2 flex gap-3">
        <button type="button" disabled={pending} onClick={fire} className="font-semibold text-error disabled:opacity-60">{t('withdraw')}</button>
        <button type="button" autoFocus onClick={() => setConfirming(false)} className="font-semibold">{t('cancel')}</button>
      </div>
      <ErrorText code={error} />
    </div>
  );
}
