'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { createContext, useActionState, useContext, useEffect, useId, useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { applyToJob, createJob, createOrganization, saveBranding, setApplicationStatus, setJobStatus, uploadLogo, withdrawApplication } from '@/lib/actions';
import { changePassword, requestPasswordReset, resetPassword, signIn, signUp, startGoogleSignIn, type FormState } from '@/lib/auth-actions';
import { PROFESSIONAL_FIELDS, resolveHumaidan } from '@/lib/humaidan';
import { Arrow, Humaidan } from './brand';

export const INPUT = 'mt-1.5 block h-12 w-full rounded-lg border border-border bg-surface px-3.5 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25';
export const PRIMARY = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-60';

const FormPending = createContext(false);

/**
 * A form that keeps what the person typed. React resets a form when a form action finishes,
 * which would wipe every field after a validation error, so this submits through a transition instead.
 */
export function ActionForm({ action, children, ...props }: { action: (form: FormData) => void } & Omit<React.FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit'>) {
  const [pending, start] = useTransition();
  return (
    <FormPending.Provider value={pending}>
      <form
        {...props}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(() => action(form));
        }}
      >
        {children}
      </form>
    </FormPending.Provider>
  );
}

export function Submit({ children, className }: { children: React.ReactNode; className?: string }) {
  const pending = useContext(FormPending);
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={clsx(PRIMARY, className)}>
      {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
      {children}
    </button>
  );
}

export function ErrorText({ code }: { code?: string }) {
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

export function Field({ label, hint, name, className, ...props }: { label: string; hint?: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId();
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input name={name} aria-describedby={hint ? hintId : undefined} className={className ?? INPUT} {...props} />
      {hint && <span id={hintId} className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function AudienceSwitch({ href, label }: { href: string; label: string }) {
  return <p className="text-center text-sm"><Link href={href} className="font-medium text-muted underline underline-offset-4 hover:text-foreground">{label}</Link></p>;
}

export function GoogleButton({ next }: { next?: string }) {
  const t = useTranslations('auth');
  return (
    <form action={startGoogleSignIn}>
      {next && <input type="hidden" name="next" value={next} />}
      <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 py-3 font-semibold transition-colors hover:bg-surface-2">
        {t('google')}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <ActionForm action={action} className="space-y-3">
      <ErrorText code={state.error} />
      {state.ok && <p role="status" className="font-semibold text-primary">{t('passwordChanged')}</p>}
      <Field name="password" type="password" autoComplete="new-password" required minLength={8} label={t('newPassword')} hint={t('passwordHint')} dir="ltr" />
      <Submit>{t('changePassword')}</Submit>
    </ActionForm>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, {});
  if (state.ok) return <p role="status" className="rounded-lg bg-surface p-4">{t('resetSent')}</p>;
  return (
    <ActionForm action={action} className="space-y-4">
      <ErrorText code={state.error} />
      <Field name="email" type="email" autoComplete="email" required label={t('email')} dir="ltr" />
      <Submit className="w-full">{t('resetRequest')}</Submit>
      <p className="text-center text-sm"><Link href="/login" className="font-semibold text-primary underline underline-offset-4">{t('backToLogin')}</Link></p>
    </ActionForm>
  );
}

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const found = params.get('type') === 'recovery' ? params.get('access_token') : null;
    // Effects can run twice, and the second run finds the fragment already gone.
    setToken((current) => current ?? found);
    if (found) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-surface p-4">{t('resetDone')}</p>
        <Link href="/login" className={PRIMARY}>{t('backToLogin')}</Link>
      </div>
    );
  }
  if (token === undefined) return null;
  if (!token) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-lg border-s-2 border-error bg-surface-2 px-3.5 py-2.5">{t('resetLinkBad')}</p>
        <Link href="/forgot-password" className="font-semibold text-primary underline underline-offset-4">{t('resetAgain')}</Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const password = String(new FormData(e.currentTarget).get('password'));
        start(async () => {
          const result = await resetPassword(token, password);
          setError(result.error);
          setDone(Boolean(result.ok));
        });
      }}
    >
      <ErrorText code={error} />
      <Field name="password" type="password" autoComplete="new-password" required minLength={8} label={t('newPassword')} hint={t('passwordHint')} dir="ltr" />
      <button type="submit" disabled={pending} aria-busy={pending} className={clsx(PRIMARY, 'w-full')}>{t('resetSubmit')}</button>
    </form>
  );
}

export function LoginForm({ audience, next, google, errorCode }: { audience: 'candidate' | 'organization'; next?: string; google?: boolean; errorCode?: string }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  const org = audience === 'organization';
  return (
    <div className="space-y-4">
    {google && !org && <GoogleButton next={next} />}
    {google && !org && <p className="text-center text-sm text-muted">{t('orEmail')}</p>}
    <ActionForm action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <ErrorText code={state.error ?? errorCode} />
      <Field name="email" type="email" autoComplete="email" required label={t('email')} dir="ltr" />
      <Field name="password" type="password" autoComplete="current-password" required label={t('password')} dir="ltr" />
      <Submit className="w-full">{t('loginSubmit')}</Submit>
      <p className="text-center text-sm"><Link href="/forgot-password" className="font-semibold text-primary underline underline-offset-4">{t('forgot')}</Link></p>
      <p className="text-center text-sm text-muted">
        {t('noAccount')} <Link href={org ? '/register?as=organization' : '/register'} className="font-semibold text-primary underline underline-offset-4">{t('registerSubmit')}</Link>
      </p>
      <AudienceSwitch href={org ? '/login' : '/login?as=organization'} label={t(org ? 'toCandidateLogin' : 'toOrgLogin')} />
    </ActionForm>
    </div>
  );
}

export function RegisterForm({ audience }: { audience: 'candidate' | 'organization' }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const org = audience === 'organization';
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="account_type" value={audience} />
      <ErrorText code={state.error} />
      <Field name="display_name" autoComplete="name" required maxLength={200} label={t('displayName')} />
      {org && (
        <>
          <Field name="org_name_ar" required maxLength={200} dir="rtl" label={t('orgNameAr')} />
          <Field name="org_name_en" required maxLength={200} dir="ltr" label={t('orgNameEn')} />
        </>
      )}
      <Field name="email" type="email" autoComplete="email" required label={t('email')} dir="ltr" />
      <Field name="password" type="password" autoComplete="new-password" required minLength={8} label={t('password')} hint={t('passwordHint')} dir="ltr" />
      <Submit className="w-full">{t('registerSubmit')}</Submit>
      <p className="text-center text-sm text-muted">
        {t('haveAccount')} <Link href={org ? '/login?as=organization' : '/login'} className="font-semibold text-primary underline underline-offset-4">{t('loginSubmit')}</Link>
      </p>
      <AudienceSwitch href={org ? '/register' : '/register?as=organization'} label={t(org ? 'toCandidateRegister' : 'toOrgRegister')} />
    </ActionForm>
  );
}

export function BrandingForm({ orgId, branding, logoUrl, canEdit }: {
  orgId: string;
  logoUrl: string | null;
  canEdit: boolean;
  branding: { industry: string | null; primary_color: string | null; accent_color: string | null; welcome_ar: string | null; welcome_en: string | null } | null;
}) {
  const t = useTranslations('branding');
  const tf = useTranslations('fields');
  const [state, action] = useActionState<FormState, FormData>(saveBranding.bind(null, orgId), {});
  const [industry, setIndustry] = useState(branding?.industry ?? '');
  const [uploading, start] = useTransition();
  const [logoError, setLogoError] = useState<string>();
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_16rem]">
      <div className="space-y-8">
        {!canEdit && <p className="border-s-2 border-gold ps-4 text-sm font-medium">{t('readOnly')}</p>}
        <div>
          <p className="text-sm font-medium">{t('logo')}</p>
          <div className="mt-2 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl && <img src={logoUrl} alt={t('logo')} className="h-14 w-auto max-w-40 rounded object-contain" />}
            {canEdit && (
              <label className={clsx('inline-flex cursor-pointer items-center rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-primary', uploading && 'opacity-60')}>
                <input
                  type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) return setLogoError('too_large');
                    const form = new FormData();
                    form.append('file', file);
                    start(async () => setLogoError((await uploadLogo(orgId, form)).error));
                  }}
                />
                {uploading ? t('uploading') : t('uploadLogo')}
              </label>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{t('logoHint')}</p>
          <ErrorText code={logoError} />
        </div>
        <ActionForm action={action}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <ErrorText code={state.error} />
            <label className="block">
              <span className="text-sm font-medium">{t('industry')}</span>
              <select name="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className={INPUT}>
                <option value="" disabled>{t('notSet')}</option>
                {PROFESSIONAL_FIELDS.map((f) => <option key={f} value={f}>{tf(f)}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted">{t('industryHint')}</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Field name="primary_color" type="color" label={t('primaryColor')} defaultValue={branding?.primary_color ?? '#1F7A4D'} className={clsx(INPUT, 'p-1')} />
              <Field name="accent_color" type="color" label={t('accentColor')} defaultValue={branding?.accent_color ?? '#D4AF37'} className={clsx(INPUT, 'p-1')} />
            </div>
            <label className="block">
              <span className="text-sm font-medium">{t('welcomeAr')}</span>
              <textarea name="welcome_ar" dir="rtl" rows={2} maxLength={600} defaultValue={branding?.welcome_ar ?? ''} className={clsx(INPUT, 'h-auto py-2.5')} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">{t('welcomeEn')}</span>
              <textarea name="welcome_en" dir="ltr" rows={2} maxLength={600} defaultValue={branding?.welcome_en ?? ''} className={clsx(INPUT, 'h-auto py-2.5')} />
            </label>
            {canEdit && (
              <div className="flex items-center gap-4">
                <Submit>{t('save')}</Submit>
                {state.ok && <span role="status" className="font-semibold text-primary">{t('saved')}</span>}
              </div>
            )}
          </fieldset>
        </ActionForm>
      </div>
      <aside className="rounded-lg bg-surface p-5 lg:self-start">
        <p className="font-semibold">{t('preview')}</p>
        <div className="mx-auto mt-3 w-40"><Humaidan outfit={resolveHumaidan(null, industry)} sizes="160px" /></div>
        <p className="mt-3 text-xs text-muted">{t('previewNote')}</p>
      </aside>
    </div>
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
    <ActionForm action={action} className="space-y-4">
      <ErrorText code={state.error} />
      <Field name="name_ar" required maxLength={200} label={t('nameAr')} dir="rtl" />
      <Field name="name_en" required maxLength={200} label={t('nameEn')} dir="ltr" onChange={(e) => !edited && setSlug(toSlug(e.target.value))} />
      <Field name="slug" required maxLength={80} label={t('slug')} hint={t('slugHint')} dir="ltr" value={slug} onChange={(e) => { setEdited(true); setSlug(e.target.value); }} />
      <Submit>{t('create')}<Arrow /></Submit>
    </ActionForm>
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
            <ActionForm action={action} className="mt-4 grid gap-4 rounded-lg bg-surface p-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><ErrorText code={state.error} /></div>
              <Field name="title_ar" required maxLength={200} label={t('titleAr')} dir="rtl" />
              <Field name="title_en" required maxLength={200} label={t('titleEn')} dir="ltr" onChange={(e) => setSlug(toSlug(e.target.value))} />
              <Field name="slug" required maxLength={80} label={t('jobSlug')} hint={t('slugHint')} dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <div className="flex items-start pt-6"><Submit>{t('createJob')}</Submit></div>
            </ActionForm>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Opens a signed file link. The tab has to open during the click itself, or browsers block it,
 * so it opens empty and is pointed at the link once the server answers.
 */
export async function openFileLink(getLink: () => Promise<{ url?: string; error?: string }>, setError: (code?: string) => void) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  const result = await getLink();
  setError(result.error);
  if (!tab) return;
  if (result.url) tab.location.href = result.url;
  else tab.close();
}

export function useAction(run: () => Promise<FormState>) {
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

const ORG_STATUSES = ['submitted', 'under_review', 'shortlisted', 'rejected', 'hired'];

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
