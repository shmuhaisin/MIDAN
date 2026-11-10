'use client';

// Company setup, one step at a time: what the company does, its logo and the identity read from it, then its team.
// Every step saves through the API and moves on by itself when the save succeeds; when it fails, the person keeps what
// they typed, reads what went wrong, and can try again. Nothing here decides access: a MIDAN administrator already
// approved this representative, and the API checks the role on every call.
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { FormState } from '@/lib/auth-actions';
import { PROFESSIONAL_FIELDS } from '@/lib/humaidan';
import type { BrandPalette, ThemeColors } from '@/lib/org-theme';
import { approveIdentity, previewIdentity, rereadLogoColours, saveCompanyDetails, uploadCompanyLogo, type IdentityChoice } from '@/lib/setup-actions';
import { COMPANY_TYPES } from './assessment-intel';
import { ErrorText, INPUT } from './forms';
import { Icon } from './icons';

export type SetupDetails = { industry: string | null; company_type: string | null; welcome_ar: string | null; welcome_en: string | null };
export type SetupIdentity = { logoUrl: string | null; palette: BrandPalette | null; status: 'suggested' | 'approved' | null; current: boolean };

const STEPS = ['details', 'identity', 'team'] as const;

function Spinner() {
  return <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />;
}

/** The three steps across the top: done ones can be revisited, the current one is marked, later ones wait. */
export function SetupSteps({ orgId, step, done }: { orgId: string; step: number; done: boolean[] }) {
  const t = useTranslations('companySetup');
  const router = useRouter();
  return (
    <nav aria-label={t('stepsLabel')}>
      <ol className="grid grid-cols-3 gap-2 sm:gap-3">
        {STEPS.map((key, i) => {
          const n = i + 1;
          const state = n === step ? 'current' : done[i] ? 'done' : 'next';
          const reachable = n !== step && (done[i] || done.slice(0, i).every(Boolean));
          const body = (
            <>
              <span aria-hidden className={clsx('block h-1 rounded-full', state === 'current' ? 'bg-[var(--button)]' : state === 'done' ? 'bg-primary/60' : 'bg-surface-3')} />
              <span className="mt-3 flex items-center gap-2 text-start text-sm">
                <span aria-hidden className={clsx('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold', state === 'done' ? 'bg-primary text-primary-foreground' : state === 'current' ? 'bg-[var(--button)] text-[var(--button-foreground)]' : 'border border-border-strong text-muted')}>
                  {state === 'done' ? <Icon name="check" className="size-3.5" /> : n}
                </span>
                <span className={clsx('min-w-0', state === 'current' ? 'font-semibold' : 'text-muted')}>
                  <span className="block truncate">{t(`step.${key}.name`)}</span>
                  <span className="sr-only">{t(`state.${state}`)}</span>
                </span>
              </span>
            </>
          );
          return (
            <li key={key} aria-current={state === 'current' ? 'step' : undefined}>
              {reachable ? <button type="button" onClick={() => router.push(`/organization/${orgId}/setup?step=${n}`)} className="block w-full rounded-[var(--radius-control)] hover:opacity-80">{body}</button> : <div>{body}</div>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A short "saved, moving on" line, so the person sees the save land before the next step appears. */
function Saved({ label }: { label: string }) {
  return <p role="status" className="flex items-center gap-2 text-sm font-semibold text-success"><Icon name="check" className="size-4" />{label}</p>;
}

// ---------- Step 1: company details ----------

export function DetailsStep({ orgId, initial, canEdit }: { orgId: string; initial: SetupDetails; canEdit: boolean }) {
  const t = useTranslations('companySetup');
  const tf = useTranslations('fields');
  const tc = useTranslations('assessmentIntel.companyTypes');
  const router = useRouter();
  const draftKey = `midan:setup:${orgId}:details`;
  const [values, setValues] = useState({
    industry: initial.industry ?? '', company_type: initial.company_type ?? '', welcome_ar: initial.welcome_ar ?? '', welcome_en: initial.welcome_en ?? '',
  });
  const [state, setState] = useState<FormState>({});
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const restored = useRef(false);

  // A draft kept in this browser, so a reload or a lost connection doesn't lose what was typed. It never overrides
  // anything already saved, and it's cleared once the save succeeds.
  useEffect(() => {
    if (restored.current || !canEdit) return;
    restored.current = true;
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Partial<typeof values> | null;
      if (draft) setValues((v) => ({ industry: v.industry || draft.industry || '', company_type: v.company_type || draft.company_type || '', welcome_ar: v.welcome_ar || draft.welcome_ar || '', welcome_en: v.welcome_en || draft.welcome_en || '' }));
    } catch { /* no storage: the form works without a draft */ }
  }, [canEdit, draftKey]);
  const update = (name: keyof typeof values, value: string) => {
    setValues((v) => {
      const next = { ...v, [name]: value };
      try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const missingIndustry = tried && !values.industry;

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!values.industry) return;
        const form = new FormData(e.currentTarget);
        start(async () => {
          const result = await saveCompanyDetails(orgId, form);
          setState(result);
          if (result.ok) {
            try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
            router.push(`/organization/${orgId}/setup?step=2`);
          }
        });
      }}
    >
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">{t('details.industry')} <span className="text-error" aria-hidden>*</span></span>
            <select name="industry" required aria-invalid={missingIndustry || undefined} aria-describedby="industry-hint" value={values.industry} onChange={(e) => update('industry', e.target.value)} className={INPUT}>
              <option value="" disabled>{t('details.choose')}</option>
              {PROFESSIONAL_FIELDS.map((f) => <option key={f} value={f}>{tf(f)}</option>)}
            </select>
            <span id="industry-hint" className={clsx('field-hint', missingIndustry && 'text-error')}>{missingIndustry ? t('details.industryMissing') : t('details.industryHint')}</span>
          </label>
          <label className="block">
            <span className="field-label">{t('details.companyType')} <span className="font-normal text-muted">{t('optional')}</span></span>
            <select name="company_type" value={values.company_type} onChange={(e) => update('company_type', e.target.value)} className={INPUT}>
              <option value="">{t('details.notSet')}</option>
              {COMPANY_TYPES.map((k) => <option key={k} value={k}>{tc(k)}</option>)}
            </select>
            <span className="field-hint">{t('details.companyTypeHint')}</span>
          </label>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {(['ar', 'en'] as const).map((lang) => (
            <label key={lang} className="block">
              <span className="field-label">{t(`details.welcome_${lang}`)} <span className="font-normal text-muted">{t('optional')}</span></span>
              <textarea name={`welcome_${lang}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} rows={3} maxLength={600} value={values[`welcome_${lang}`]} onChange={(e) => update(`welcome_${lang}`, e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
              <span className="field-hint flex justify-between gap-3"><span>{t('details.welcomeHint')}</span><span className="num shrink-0">{values[`welcome_${lang}`].length}/600</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorText code={state.error} detail={state.detail} />
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <p className="text-sm text-muted">{t('details.draftNote')}</p>
          <div className="flex items-center gap-4">
            {state.ok && <Saved label={t('savedMoving')} />}
            <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary">
              {pending && <Spinner />}{pending ? t('saving') : t('saveContinue')}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

// ---------- Step 2: logo and identity ----------

export function IdentityStep({ orgId, orgName, identity, canEdit, logoNote }: { orgId: string; orgName: string; identity: SetupIdentity; canEdit: boolean; logoNote?: string }) {
  const t = useTranslations('companySetup');
  const router = useRouter();
  const [local, setLocal] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<FormState & { paletteError?: string | null }>({});
  const [uploading, startUpload] = useTransition();
  const [rereading, startReread] = useTransition();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const logo = local ?? identity.logoUrl;
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setUploadState({ error: 'logo_type' });
    if (file.size > 2 * 1024 * 1024) return setUploadState({ error: 'too_large' });
    setLocal(URL.createObjectURL(file));
    const form = new FormData();
    form.append('file', file);
    startUpload(async () => {
      const result = await uploadCompanyLogo(orgId, form);
      setUploadState(result);
      if (result.ok) router.refresh();
    });
  };
  // A file chosen before the page finished loading reached the input while it had no change handler yet, and was lost
  // without a word (seen in the browser suite). It's picked up once the page is ready.
  useEffect(() => {
    const early = input.current?.files?.[0];
    if (early) { onFile(early); input.current!.value = ''; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the file present when the page became interactive
  }, []);

  return (
    <div className="space-y-8">
      <section aria-labelledby="logo-title" className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-center">
        <div className="grid aspect-[4/3] place-items-center rounded-[var(--radius-panel)] border border-dashed border-border-strong bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- the organization's own upload, from Storage or this browser */}
          {logo ? <img src={logo} alt={t('identity.logoAlt', { org: orgName })} className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-muted">{t('identity.noLogo')}</span>}
        </div>
        <div>
          <h2 id="logo-title" className="font-display text-xl font-bold">{t('identity.logoTitle')}</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{t('identity.logoLead')}</p>
          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label htmlFor={inputId} className={clsx('btn cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-primary', logo ? 'btn-secondary' : 'btn-primary', uploading && 'pointer-events-none opacity-70')}>
                {uploading && <Spinner />}
                {uploading ? t('identity.reading') : logo ? t('identity.replace') : t('identity.upload')}
                <input ref={input} id={inputId} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {identity.logoUrl && !identity.palette && !uploading && (
                <button type="button" disabled={rereading} aria-busy={rereading} onClick={() => startReread(async () => { const r = await rereadLogoColours(orgId); setUploadState(r); if (r.ok) router.refresh(); })} className="btn btn-ghost">
                  {rereading && <Spinner />}{t('identity.reread')}
                </button>
              )}
              <span className="text-xs text-muted">{t('identity.fileHint')}</span>
            </div>
          )}
          {logoNote && <p className="mt-3 text-sm text-muted">{logoNote}</p>}
          <div className="mt-3"><ErrorText code={uploadState.error} detail={uploadState.detail} /></div>
          {uploadState.paletteError && <p role="status" className="callout mt-3 text-sm">{t('identity.unreadable')}</p>}
        </div>
      </section>

      {uploading || rereading ? (
        // While a logo is being read, the earlier identity can't be approved by mistake: it's replaced until the new colours arrive.
        <div role="status" className="flex items-center gap-3 border-t border-border pt-8 text-sm text-muted"><Spinner />{t('identity.readingColours')}</div>
      ) : identity.palette ? (
        <IdentityEditor key={`${identity.palette.primary}-${identity.palette.accent}-${identity.status}`} orgId={orgId} orgName={orgName} palette={identity.palette} status={identity.status} current={identity.current} canEdit={canEdit} logo={identity.logoUrl} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <p className="max-w-prose text-sm text-muted">{t('identity.withoutLogo')}</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => router.push(`/organization/${orgId}/setup?step=1`)} className="btn btn-ghost">{t('back')}</button>
            <button type="button" onClick={() => router.push(`/organization/${orgId}/setup?step=3`)} className="btn btn-secondary">{t('identity.skip')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SwatchPicker({ label, name, swatches, value, onChange, allowNone, noneLabel }: { label: string; name: string; swatches: string[]; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {swatches.map((hex) => (
          <label key={hex} className={clsx('group relative grid size-11 cursor-pointer place-items-center rounded-full border-2 transition-transform has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--focus)]', value === hex ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105')}>
            <input type="radio" name={name} value={hex} checked={value === hex} onChange={() => onChange(hex)} className="sr-only" />
            <span aria-hidden className="size-8 rounded-full border border-black/10" style={{ background: hex }} />
            <span className="sr-only">{hex}</span>
            {value === hex && <Icon name="check" className="absolute size-4 text-white mix-blend-difference" />}
          </label>
        ))}
        {allowNone && (
          <label className={clsx('flex h-11 cursor-pointer items-center rounded-full border-2 px-3 text-sm has-focus-visible:outline-2 has-focus-visible:outline-[var(--focus)]', value === null ? 'border-foreground font-semibold' : 'border-border')}>
            <input type="radio" name={name} value="" checked={value === null} onChange={() => onChange(null)} className="sr-only" />
            {noneLabel}
          </label>
        )}
      </div>
    </fieldset>
  );
}

function IdentityEditor({ orgId, orgName, palette, status, current, canEdit, logo }: { orgId: string; orgName: string; palette: BrandPalette; status: 'suggested' | 'approved' | null; current: boolean; canEdit: boolean; logo: string | null }) {
  const t = useTranslations('companySetup');
  const router = useRouter();
  const suggested: IdentityChoice = { primary: palette.primary, accent: palette.accent };
  const [choice, setChoice] = useState<IdentityChoice>(suggested);
  const [themes, setThemes] = useState<{ light: ThemeColors; dark: ThemeColors }>({ light: palette.light, dark: palette.dark });
  const [previewError, setPreviewError] = useState<string>();
  const [state, setState] = useState<FormState>({});
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();
  const colours = useMemo(() => [...new Set([palette.primary, palette.secondary, palette.accent, ...palette.swatches.map((s) => s.hex)].filter((h): h is string => Boolean(h)))], [palette]);
  const changed = choice.primary !== suggested.primary || choice.accent !== suggested.accent;
  const approvedAsIs = status === 'approved' && current && !changed;

  const choose = (next: IdentityChoice) => {
    setChoice(next);
    if (next.primary === suggested.primary && next.accent === suggested.accent) {
      setThemes({ light: palette.light, dark: palette.dark });
      return;
    }
    startPreview(async () => {
      const result = await previewIdentity(orgId, next);
      setPreviewError(result.error);
      if (result.light && result.dark) setThemes({ light: result.light, dark: result.dark });
    });
  };

  return (
    <section aria-labelledby="identity-title" className="space-y-6 border-t border-border pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="identity-title" className="font-display text-xl font-bold">{t('identity.title')}</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{palette.monochrome ? t('identity.leadMono') : t('identity.lead')}</p>
        </div>
        <span className={clsx('rounded-full px-3 py-1 text-xs font-semibold', status === 'approved' && current ? 'bg-success-surface text-success' : 'bg-warning-surface text-warning')}>
          {status === 'approved' && current ? t('identity.statusApproved') : t('identity.statusSuggested')}
        </span>
      </div>

      <div>
        <p className="field-label">{t('identity.fromLogo')}</p>
        <ul className="mt-2 flex h-9 overflow-hidden rounded-[var(--radius-control)] border border-border" aria-label={t('identity.fromLogo')}>
          {palette.swatches.map((s) => (
            <li key={s.hex} style={{ background: s.hex, flexGrow: Math.max(s.share, 0.04) }} title={`${s.hex} · ${Math.round(s.share * 100)}%`}>
              <span className="sr-only">{`${s.hex}, ${Math.round(s.share * 100)}%`}</span>
            </li>
          ))}
        </ul>
        {palette.background && <p className="mt-2 text-xs text-muted">{t('identity.backgroundIgnored', { colour: palette.background })}</p>}
      </div>

      {canEdit && (
        <div className="grid gap-6 sm:grid-cols-2">
          <SwatchPicker label={t('identity.primary')} name="primary" swatches={colours} value={choice.primary} onChange={(v) => v && choose({ ...choice, primary: v })} />
          <SwatchPicker label={t('identity.accent')} name="accent" swatches={colours.filter((h) => h !== choice.primary)} value={choice.accent} onChange={(v) => choose({ ...choice, accent: v })} allowNone noneLabel={t('identity.noAccent')} />
        </div>
      )}

      <div aria-live="polite" aria-busy={previewing} className={clsx('grid gap-4 transition-opacity lg:grid-cols-2', previewing && 'opacity-60')}>
        <WorkspacePreview theme="light" themes={themes} orgName={orgName} logo={logo} />
        <WorkspacePreview theme="dark" themes={themes} orgName={orgName} logo={logo} />
      </div>
      <p className="text-xs text-muted">{t('identity.contrastNote')}</p>
      <ErrorText code={previewError ?? state.error} detail={state.detail} />

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <button type="button" onClick={() => router.push(`/organization/${orgId}/setup?step=1`)} className="btn btn-ghost">{t('back')}</button>
          <div className="flex flex-wrap items-center gap-3">
            {state.ok && <Saved label={t('savedMoving')} />}
            {changed && <button type="button" onClick={() => choose(suggested)} className="btn btn-ghost">{t('identity.reset')}</button>}
            {approvedAsIs ? (
              <button type="button" onClick={() => router.push(`/organization/${orgId}/setup?step=3`)} className="btn btn-primary">{t('continue')}</button>
            ) : (
              <button
                type="button" disabled={saving || previewing} aria-busy={saving}
                onClick={() => startSave(async () => {
                  const result = await approveIdentity(orgId, choice);
                  setState(result);
                  if (result.ok) router.push(`/organization/${orgId}/setup?step=3`);
                })}
                className="btn btn-primary"
              >
                {saving && <Spinner />}{saving ? t('saving') : t('identity.approve')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** A small, faithful picture of the workspace in one theme, drawn with the colours being considered. */
function WorkspacePreview({ theme, themes, orgName, logo }: { theme: 'light' | 'dark'; themes: { light: ThemeColors; dark: ThemeColors }; orgName: string; logo: string | null }) {
  const t = useTranslations('companySetup.preview');
  const c = themes[theme];
  const page = theme === 'light' ? { bg: '#f7f4ee', surface: '#fdfcf9', text: '#1f2a26', muted: '#4d5e57', line: 'rgb(31 42 38 / 0.12)' } : { bg: '#0a1f19', surface: '#0c271e', text: '#f7f4ee', muted: '#a6bfb2', line: 'rgb(247 244 238 / 0.14)' };
  return (
    <figure className="overflow-hidden rounded-[var(--radius-panel)] border border-border" style={{ background: page.bg, color: page.text }}>
      <div aria-hidden className="h-1.5" style={{ background: `linear-gradient(90deg, ${c.primary} 0 72%, ${c.accent} 72% 100%)` }} />
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-0 text-xs" aria-hidden>
        <div className="space-y-1 border-e p-3" style={{ borderColor: page.line }}>
          <div className="mb-3 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt="" className="size-7 rounded object-contain" style={{ background: page.surface }} /> : <span className="grid size-7 place-items-center rounded font-bold" style={{ background: c.primary, color: c.on_primary }}>{orgName.trim().charAt(0)}</span>}
            <span className="truncate font-semibold">{orgName}</span>
          </div>
          <span className="block rounded px-2 py-1.5 font-semibold" style={{ background: c.soft, color: c.on_soft, boxShadow: `inset 2px 0 0 ${c.primary}` }}>{t('jobs')}</span>
          <span className="block px-2 py-1.5" style={{ color: page.muted }}>{t('candidates')}</span>
          <span className="block px-2 py-1.5" style={{ color: page.muted }}>{t('interviews')}</span>
        </div>
        <div className="space-y-3 p-4">
          <p className="font-display text-sm font-bold">{t('heading')}</p>
          <div className="rounded p-3" style={{ background: page.surface, border: `1px solid ${page.line}` }}>
            <p className="font-semibold">{t('job')}</p>
            <p className="mt-1" style={{ color: page.muted }}>{t('jobMeta')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: c.soft, color: c.on_soft }}>{t('badge')}</span>
              <span className="font-semibold underline underline-offset-2" style={{ color: c.text }}>{t('link')}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded px-3 py-1.5 font-semibold" style={{ background: c.primary, color: c.on_primary }}>{t('primary')}</span>
            <span className="rounded border px-3 py-1.5 font-semibold" style={{ borderColor: page.line }}>{t('secondary')}</span>
            <span className="rounded px-3 py-1.5 font-semibold" style={{ background: c.accent, color: c.on_accent }}>{t('accent')}</span>
          </div>
        </div>
      </div>
      <figcaption className="border-t px-3 py-2 text-[0.6875rem] font-semibold" style={{ borderColor: page.line, color: page.muted }}>{t(theme)}</figcaption>
    </figure>
  );
}
