'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { createContext, useActionState, useContext, useEffect, useId, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { applyToJob, createJob, createOrganization, saveBranding, setApplicationStatus, setJobStatus, uploadLogo, withdrawApplication } from '@/lib/actions';
import { statusOptions } from '@/lib/application-status';
import { changePassword, requestPasswordReset, resetPassword, signIn, signUp, startGoogleSignIn, type FormState } from '@/lib/auth-actions';
import { PROFESSIONAL_FIELDS, resolveHumaidan } from '@/lib/humaidan';
import { Arrow, Humaidan } from './brand';

export const INPUT = 'input';
export const PRIMARY = 'btn btn-primary';

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
          className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-error/30 bg-error-surface px-3.5 py-2.5 text-sm text-foreground"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-error"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-.9 4h1.8v5.2H9.1zm0 6.6h1.8v1.8H9.1z" /></svg>
          <span>{t(code)}</span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, hint, name, className, type, ...props }: { label: string; hint?: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId();
  const inputId = useId();
  const t = useTranslations('auth');
  const [shown, setShown] = useState(false);
  // A password can be shown while it's typed. The toggle sits outside the label, so the field's name stays its label.
  if (type === 'password') {
    return (
      <div>
        <label htmlFor={inputId} className="field-label">{label}</label>
        <div className="relative">
          <input id={inputId} name={name} type={shown ? 'text' : 'password'} aria-describedby={hint ? hintId : undefined} className={clsx(className ?? INPUT, 'pe-20')} {...props} />
          <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-controls={inputId}
            className="absolute inset-y-0 end-0 my-1 me-1 rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-foreground">
            {shown ? t('hidePassword') : t('showPassword')}
          </button>
        </div>
        {hint && <span id={hintId} className="field-hint">{hint}</span>}
      </div>
    );
  }
  // An explicit label-for, like the password field: every assistive technology names the input from it.
  return (
    <div>
      <label htmlFor={props.id ?? inputId} className="field-label">{label}</label>
      <input id={props.id ?? inputId} name={name} type={type} aria-describedby={hint ? hintId : undefined} className={className ?? INPUT} {...props} />
      {hint && <span id={hintId} className="field-hint">{hint}</span>}
    </div>
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
      <button type="submit" className="btn btn-secondary w-full">
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
      <p className="text-center text-sm"><Link href="/login" className="link">{t('backToLogin')}</Link></p>
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
        <Link href="/forgot-password" className="link">{t('resetAgain')}</Link>
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
      <p className="text-center text-sm"><Link href="/forgot-password" className="link">{t('forgot')}</Link></p>
      <p className="text-center text-sm text-muted">
        {t('noAccount')} <Link href={org ? '/register?as=organization' : '/register'} className="link">{t('registerSubmit')}</Link>
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
        {t('haveAccount')} <Link href={org ? '/login?as=organization' : '/login'} className="link">{t('loginSubmit')}</Link>
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
        {!canEdit && <p className="callout text-sm font-medium">{t('readOnly')}</p>}
        <div>
          <p className="text-sm font-medium">{t('logo')}</p>
          <div className="mt-2 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl && <img src={logoUrl} alt={t('logo')} className="h-14 w-auto max-w-40 rounded object-contain" />}
            {canEdit && (
              <label className={clsx('btn btn-secondary btn-sm cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-primary', uploading && 'opacity-60')}>
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
              <span className="field-label">{t('industry')}</span>
              <select name="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className={INPUT}>
                <option value="" disabled>{t('notSet')}</option>
                {PROFESSIONAL_FIELDS.map((f) => <option key={f} value={f}>{tf(f)}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted">{t('industryHint')}</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Field name="primary_color" type="color" label={t('primaryColor')} defaultValue={branding?.primary_color ?? '#0F5B46'} className={clsx(INPUT, 'p-1')} />
              <Field name="accent_color" type="color" label={t('accentColor')} defaultValue={branding?.accent_color ?? '#1F7A5C'} className={clsx(INPUT, 'p-1')} />
            </div>
            <label className="block">
              <span className="field-label">{t('welcomeAr')}</span>
              <textarea name="welcome_ar" dir="rtl" rows={2} maxLength={600} defaultValue={branding?.welcome_ar ?? ''} className={clsx(INPUT, 'h-auto py-2.5')} />
            </label>
            <label className="block">
              <span className="field-label">{t('welcomeEn')}</span>
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

/**
 * Step one of the job wizard: what the job is called. It saves a draft at once, then continues on the job's own page,
 * where the remaining steps (details, requirements, skills, assessment, review) follow in order.
 */
export function JobForm({ orgId, defaultOpen = false }: { orgId: string; defaultOpen?: boolean }) {
  const t = useTranslations('org');
  const tw = useTranslations('jobWizard');
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(createJob.bind(null, orgId), {});
  const [open, setOpen] = useState(defaultOpen);
  const descriptionId = useId();
  // Once the draft exists, the guided setup continues on the job's own page. Navigation happens after rendering, never in it.
  useEffect(() => {
    if (pending || !state.ok) return;
    setOpen(false);
    if (state.id) router.push(`/organization/${orgId}/jobs/${state.id}?step=1`);
  }, [state, pending, orgId, router]);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-primary btn-sm">
        <span aria-hidden className={clsx('transition-transform', open && 'rotate-45')}>+</span>{t('addJob')}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <ActionForm action={action} className="card mt-4 space-y-5">
              <div>
                <p className="text-sm font-semibold text-gold-text">{tw('stepOf', { step: 1, total: 6 })}</p>
                <p className="section-title mt-1">{tw('step1Title')}</p>
                <p className="mt-1 text-sm text-muted">{tw('step1Lead')}</p>
              </div>
              <ErrorText code={state.error} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="title_ar" required maxLength={200} label={t('titleAr')} dir="rtl" />
                <Field name="title_en" required maxLength={200} label={t('titleEn')} dir="ltr" />
              </div>
              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="field-label mb-2">{tw('descriptionTitle')}</legend>
                {(['ar', 'en'] as const).map((lang) => (
                  <div key={lang}>
                    <label htmlFor={`${descriptionId}-${lang}`} className="field-label">{tw(lang === 'ar' ? 'descriptionAr' : 'descriptionEn')}</label>
                    <textarea id={`${descriptionId}-${lang}`} name={`description_${lang}`} rows={7} maxLength={8000} dir={lang === 'ar' ? 'rtl' : 'ltr'} className={clsx(INPUT, 'h-auto py-2.5 leading-relaxed')} />
                  </div>
                ))}
                <p className="text-xs text-muted sm:col-span-2">{tw('descriptionHint')}</p>
              </fieldset>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Submit>{tw('createAndContinue')}<Arrow /></Submit>
                <span className="text-sm text-muted">{tw('savedAsDraft')}</span>
              </div>
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
          className={clsx('btn btn-sm', value === 'published' ? 'btn-primary' : value === 'closed' ? 'btn-ghost text-muted' : 'btn-secondary')}>
          {t(label)}
        </button>
      ))}
      <ErrorText code={error} />
    </div>
  );
}

export function ApplicantStatus({ id, status, label, canReopen = false }: { id: string; status: string; label: string; canReopen?: boolean }) {
  const t = useTranslations('applicationStatus');
  const [pending, start] = useTransition();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string>();
  const options = statusOptions(status, canReopen);
  if (options.length === 1) return <span className="text-sm">{t(status)}</span>;
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
