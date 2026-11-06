'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  addPlanItem, applicationCvLink, applyAnalysis, dismissAnalysis, joinInterview, readAllNotifications, readAnalysis, readNotification, removePlanItem, respondToInterview,
  retryAnalysis, saveBasics, saveOnboarding, saveSettings, searchReferenceSkills, setCareerTarget, setPlanStatus, setReferenceSkills, submitApplication,
  type CvAnalysis, type ReferenceSkill,
} from '@/lib/candidate-actions';
import { formatWhen, number, pick } from '@/lib/format';
import { Arrow } from './brand';
import { DailyRoom } from './daily-room';
import { ErrorText, Field, INPUT, openFileLink, PRIMARY, useAction } from './forms';

const SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-foreground/30 px-5 py-2 font-semibold transition-colors hover:bg-surface-2 disabled:opacity-60';

// --- Applying

export function ApplyPanel({ jobId, hasCv }: { jobId: string; hasCv: boolean }) {
  const t = useTranslations('apply');
  const [note, setNote] = useState('');
  const { pending, error, fire } = useAction(() => submitApplication(jobId, note));
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">{t('note')}</span>
        <textarea rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
      </label>
      {!hasCv && <p className="border-s-2 border-gold ps-3 text-sm">{t('noCv')}</p>}
      <ErrorText code={error} />
      <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className={PRIMARY}>
        {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
        {t('submit')}<Arrow />
      </button>
    </div>
  );
}

export function SubmittedCvButton({ id }: { id: string }) {
  const t = useTranslations('application');
  const [error, setError] = useState<string>();
  return (
    <>
      <button type="button" className="font-semibold text-primary underline underline-offset-4" onClick={() => openFileLink(() => applicationCvLink(id), setError)}>{t('openCv')}</button>
      <ErrorText code={error} />
    </>
  );
}

// --- Choosing skills from the sector reference

const SECTOR_KEYS = ['digital', 'culture_entertainment', 'tourism_hospitality', 'manufacturing', 'construction_real_estate', 'financial_services', 'wholesale_retail'] as const;

export function ReferenceSkillPicker({ selected }: { selected: { id: string; name_ar: string; sector_code: string }[] }) {
  const t = useTranslations('candidateSkills');
  const ts = useTranslations('sectors');
  const [chosen, setChosen] = useState(selected);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReferenceSkill[]>([]);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});

  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(() => startSearch(async () => setResults(await searchReferenceSkills(query))), 300);
    return () => clearTimeout(timer);
  }, [query]);

  function save(next: typeof chosen) {
    setChosen(next);
    setState({});
    startSave(async () => setState(await setReferenceSkills(next.map((s) => s.id))));
  }

  const visible = query.trim().length < 2 ? [] : results.filter((r) => !chosen.some((c) => c.id === r.id));
  return (
    <div>
      <p className="text-sm text-muted">{t('note')}</p>
      {chosen.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {chosen.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
              {s.name_ar}
              <button type="button" aria-label={t('removeSkill', { skill: s.name_ar })} onClick={() => save(chosen.filter((c) => c.id !== s.id))} className="font-bold">×</button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 block">
        <span className="text-sm font-medium">{t('search')}</span>
        <input type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} className={INPUT} />
      </label>
      {searching && <p className="mt-2 text-sm text-muted">{t('searching')}</p>}
      {!searching && query.trim().length >= 2 && visible.length === 0 && <p className="mt-2 text-sm text-muted">{t('noResults')}</p>}
      {visible.length > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface">
          {visible.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => save([...chosen, r])} className="block w-full px-3.5 py-2.5 text-start hover:bg-surface-2">
                <span className="font-medium">{r.name_ar}</span>
                <span className="block text-xs text-muted">{ts(r.sector_code)}</span>
                {r.description_ar && <span className="mt-0.5 block text-sm text-muted">{r.description_ar}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {saving && <p className="mt-2 text-sm text-muted">{t('saving')}</p>}
      {state.ok && !saving && <p role="status" className="mt-2 text-sm font-semibold text-primary">{t('saved')}</p>}
      <ErrorText code={state.error} />
    </div>
  );
}

// --- CV status and review

const FAILURE_KEYS = new Set(['unsupported_format', 'unreadable', 'encrypted', 'no_text', 'no_sections', 'ocr_unavailable', 'ocr_failed', 'ai_unavailable', 'ai_invalid_response', 'privacy_check_failed', 'analysis_unavailable', 'file_unavailable', 'analysis_failed']);

/** Follows an analysis while it runs. A failure offers a retry or filling the profile in by hand, never a shortcut. */
export function CvAnalysisStatus({ analysis: initial, compact }: { analysis: CvAnalysis | null; compact?: boolean }) {
  const t = useTranslations('cvAnalysis');
  const router = useRouter();
  const [analysis, setAnalysis] = useState(initial);
  const retry = useAction(async () => {
    const result = await retryAnalysis();
    if (result.id) setAnalysis(await readAnalysis(result.id));
    return result;
  });

  useEffect(() => setAnalysis(initial), [initial]);
  useEffect(() => {
    if (analysis?.status !== 'pending') return;
    const timer = setInterval(async () => {
      const next = await readAnalysis(analysis.id);
      if (next && next.status !== 'pending') {
        setAnalysis(next);
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [analysis, router]);

  if (!analysis || ['applied', 'dismissed'].includes(analysis.status)) return null;
  if (analysis.status === 'pending') return <p role="status" aria-live="polite" className="rounded-lg bg-surface-2 p-3 text-sm">{t('pending')}</p>;
  if (analysis.status === 'awaiting_review') {
    return (
      <div className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">
        <p role="status" className="font-semibold">{t('ready')}</p>
        <Link href={`/profile/cv/${analysis.id}`} className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-4">{t('review')}<Arrow /></Link>
      </div>
    );
  }
  const code = analysis.failure_code && FAILURE_KEYS.has(analysis.failure_code) ? analysis.failure_code : 'analysis_failed';
  return (
    <div role="alert" className="rounded-lg border-s-2 border-error bg-surface-2 p-3 text-sm">
      <p className="font-semibold">{t(analysis.status === 'blocked' ? 'blockedTitle' : 'failedTitle')}</p>
      <p className="mt-1">{t(`failure.${code}`)}</p>
      {!compact && <p className="mt-1 text-muted">{t('manual')}</p>}
      <button type="button" disabled={retry.pending} onClick={retry.fire} className="mt-2 font-semibold underline underline-offset-4">{t('retry')}</button>
      <ErrorText code={retry.error} />
    </div>
  );
}

type Choice = { checked: boolean };
const withChoice = <T,>(items: T[] | undefined, checked = true) => (items ?? []).map((item) => ({ ...item, checked }));

export function CvReview({ analysis, current }: { analysis: CvAnalysis; current: { full_name?: string; phone?: string | null; city?: string | null; headline?: string | null; summary?: string | null } | null }) {
  const t = useTranslations('cvAnalysis');
  const router = useRouter();
  const pro = analysis.professional;
  const personal = analysis.personal;
  // A field the candidate already filled in stays unticked, so a reanalysis can't quietly replace a correction.
  const start = (value: string | null | undefined, existing: string | null | undefined) => ({ value: value ?? '', checked: Boolean(value) && !existing });
  const [fields, setFields] = useState({
    full_name: start(personal?.full_name, current?.full_name), phone: start(personal?.phone, current?.phone), city: start(personal?.city, current?.city),
    headline: start(pro?.headline, current?.headline), summary: start(pro?.summary, current?.summary),
  });
  const [experience, setExperience] = useState(withChoice(pro?.experience));
  const [education, setEducation] = useState(withChoice(pro?.education));
  const [projects, setProjects] = useState(withChoice(pro?.projects));
  const [courses, setCourses] = useState(withChoice(pro?.courses));
  const [certifications, setCertifications] = useState(withChoice(pro?.certifications));
  const [skills, setSkills] = useState(() => (pro?.skills ?? []).map((name) => ({ name, checked: true })));

  function body() {
    const clean = <T extends Choice>(items: T[]) => items.filter((i) => i.checked).map(({ checked: _, ...rest }) => Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== '')));
    const chosen = Object.fromEntries(Object.entries(fields).filter(([, f]) => f.checked && f.value.trim()).map(([k, f]) => [k, f.value.trim()]));
    return {
      ...chosen,
      ...(experience.some((e) => e.checked) && { experience: clean(experience) }),
      ...(education.some((e) => e.checked) && { education: clean(education) }),
      ...(projects.some((e) => e.checked) && { projects: clean(projects) }),
      ...(courses.some((e) => e.checked) && { courses: clean(courses) }),
      ...(certifications.some((e) => e.checked) && { certifications: clean(certifications) }),
      ...(skills.some((s) => s.checked) && { skills: skills.filter((s) => s.checked).map((s) => s.name) }),
    };
  }

  const save = useAction(async () => {
    const result = await applyAnalysis(analysis.id, body());
    if (result.ok) router.push('/profile');
    return result;
  });
  const dismiss = useAction(async () => {
    const result = await dismissAnalysis(analysis.id);
    if (result.ok) router.push('/profile');
    return result;
  });

  const scalar = (key: keyof typeof fields, multiline = false) => {
    const field = fields[key];
    const set = (patch: Partial<typeof field>) => setFields({ ...fields, [key]: { ...field, ...patch } });
    return (
      <div key={key} className="flex items-start gap-3">
        <input type="checkbox" aria-label={t('use', { field: t(`fields.${key}`) })} checked={field.checked} onChange={(e) => set({ checked: e.target.checked })} className="mt-9 size-4 accent-[var(--primary)]" />
        <label className="block flex-1">
          <span className="text-sm font-medium">{t(`fields.${key}`)}</span>
          {current?.[key] && <span className="ms-2 text-xs text-muted">{t('currentValue', { value: String(current[key]).slice(0, 60) })}</span>}
          {multiline
            ? <textarea rows={4} dir="auto" value={field.value} onChange={(e) => set({ value: e.target.value })} className={clsx(INPUT, 'h-auto py-2.5')} />
            : <input dir="auto" value={field.value} onChange={(e) => set({ value: e.target.value })} className={INPUT} />}
        </label>
      </div>
    );
  };

  const group = <T extends Choice & { title?: string; qualification?: string }>(key: string, items: T[], set: (items: T[]) => void) =>
    items.length === 0 ? null : (
      <fieldset key={key}>
        <legend className="font-display text-xl font-semibold">{t(`groups.${key}`)}</legend>
        <ul className="mt-2 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <input type="checkbox" aria-label={item.title ?? item.qualification} checked={item.checked} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} className="mt-3.5 size-4 accent-[var(--primary)]" />
              <input
                dir="auto" aria-label={t(`groups.${key}`)} value={item.title ?? item.qualification ?? ''}
                onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, ...('qualification' in x ? { qualification: e.target.value } : { title: e.target.value }) } : x)))}
                className={clsx(INPUT, 'mt-0 flex-1')}
              />
            </li>
          ))}
        </ul>
      </fieldset>
    );

  const missing = (pro?.uncertain ?? []).filter((u) => u !== 'local_reading');
  const removed = Object.values(analysis.redaction_counts ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-8">
      <div className="rounded-lg bg-surface p-4 text-sm">
        <p className="font-semibold">{t(analysis.mode === 'external_ai' ? 'modeExternal' : 'modeLocal')}</p>
        <p className="mt-1 text-muted">{t('privacyNote', { count: number(useLocale(), removed) })}</p>
        {missing.length > 0 && <p className="mt-2 font-medium">{t('uncertain', { sections: missing.join('، ') })}</p>}
      </div>
      <fieldset className="space-y-3">
        <legend className="font-display text-xl font-semibold">{t('groups.personal')}</legend>
        <p className="text-sm text-muted">{t('personalNote')}</p>
        {scalar('full_name')}{scalar('phone')}{scalar('city')}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-display text-xl font-semibold">{t('groups.overview')}</legend>
        {scalar('headline')}{scalar('summary', true)}
      </fieldset>
      {group('experience', experience, setExperience)}
      {group('education', education, setEducation)}
      {group('projects', projects, setProjects)}
      {group('courses', courses, setCourses)}
      {group('certifications', certifications, setCertifications)}
      {skills.length > 0 && (
        <fieldset>
          <legend className="font-display text-xl font-semibold">{t('groups.skills')}</legend>
          <p className="text-sm text-muted">{t('skillsNote')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {skills.map((s, i) => (
              <li key={s.name}>
                <label className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={s.checked} onChange={(e) => setSkills(skills.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} className="size-4 accent-[var(--primary)]" />
                  <bdi>{s.name}</bdi>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <ErrorText code={save.error ?? dismiss.error} />
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={save.pending} aria-busy={save.pending} onClick={save.fire} className={PRIMARY}>{t('approve')}<Arrow /></button>
        <button type="button" disabled={dismiss.pending} onClick={dismiss.fire} className="font-semibold">{t('dismiss')}</button>
      </div>
    </div>
  );
}

// --- Onboarding

export function OnboardingBasics({ profile, fallbackName }: { profile: { full_name?: string; phone?: string | null; city?: string | null; headline?: string | null } | null; fallbackName: string }) {
  const t = useTranslations('onboarding');
  const tp = useTranslations('profile');
  const router = useRouter();
  const [values, setValues] = useState({ full_name: profile?.full_name ?? fallbackName, phone: profile?.phone ?? '', city: profile?.city ?? '', headline: profile?.headline ?? '' });
  const { pending, error, fire } = useAction(async () => {
    const saved = await saveBasics({ full_name: values.full_name, phone: values.phone.trim() || null, city: values.city.trim() || null, headline: values.headline.trim() || null });
    if (saved.ok) {
      await saveOnboarding(1);
      router.push('/onboarding?step=2');
    }
    return saved;
  });
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: e.target.value });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <ErrorText code={error} />
      <Field name="full_name" required maxLength={200} autoComplete="name" label={tp('fullName')} value={values.full_name} onChange={set('full_name')} />
      <Field name="phone" type="tel" dir="ltr" maxLength={30} autoComplete="tel" label={t('phone')} value={values.phone} onChange={set('phone')} />
      <Field name="city" maxLength={100} label={tp('city')} value={values.city} onChange={set('city')} />
      <Field name="headline" maxLength={200} label={tp('headline')} value={values.headline} onChange={set('headline')} />
      <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('next')}<Arrow /></button>
    </form>
  );
}

export function OnboardingStepButton({ step, finish, label, href }: { step: number; finish?: boolean; label: string; href: string }) {
  const router = useRouter();
  const { pending, error, fire } = useAction(async () => {
    const saved = await saveOnboarding(step, finish);
    if (saved.ok) router.push(href);
    return saved;
  });
  return (
    <div>
      <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className={PRIMARY}>{label}<Arrow /></button>
      <ErrorText code={error} />
    </div>
  );
}

// --- Interviews

export function InterviewActions({ id, status }: { id: string; status: string }) {
  const t = useTranslations('interview');
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const accept = useAction(() => respondToInterview(id, 'accept'));
  const ask = useAction(async () => {
    const result = await respondToInterview(id, 'request_reschedule', note);
    if (result.ok) setAsking(false);
    return result;
  });
  if (!['invited', 'accepted'].includes(status)) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {status === 'invited' && <button type="button" disabled={accept.pending} aria-busy={accept.pending} onClick={accept.fire} className={PRIMARY}>{t('accept')}</button>}
        {!asking && <button type="button" onClick={() => setAsking(true)} className={SECONDARY}>{t('requestReschedule')}</button>}
      </div>
      {asking && (
        <form className="space-y-3 rounded-lg bg-surface p-4" onSubmit={(e) => { e.preventDefault(); ask.fire(); }}>
          <label className="block">
            <span className="text-sm font-medium">{t('rescheduleNote')}</span>
            <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
          </label>
          <p className="text-sm text-muted">{t('rescheduleHint')}</p>
          <div className="flex items-center gap-4">
            <button type="submit" disabled={ask.pending} aria-busy={ask.pending} className={PRIMARY}>{t('sendRequest')}</button>
            <button type="button" onClick={() => setAsking(false)} className="font-semibold">{t('cancel')}</button>
          </div>
        </form>
      )}
      <ErrorText code={accept.error ?? ask.error} />
    </div>
  );
}

export function InterviewJoin({ id, opensAt, closesAt, canJoin, videoAvailable, timeZone }: { id: string; opensAt: string; closesAt: string; canJoin: boolean; videoAvailable: boolean; timeZone: string }) {
  const t = useTranslations('interview');
  const locale = useLocale();
  const [call, setCall] = useState<{ room_url: string; token: string } | null>(null);
  const [left, setLeft] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const join = useAction(async () => {
    const result = await joinInterview(id);
    if (result.room_url && result.token) {
      setCall({ room_url: result.room_url, token: result.token });
      setLeft(false);
      return { ok: true };
    }
    return { error: result.error };
  });

  if (!videoAvailable) return <p className="rounded-lg bg-surface-2 p-3 text-sm">{t('videoNotConfigured')}</p>;
  if (!canJoin) return <p className="text-sm text-muted">{t('acceptFirst')}</p>;
  if (call) return <DailyRoom url={call.room_url} token={call.token} onLeft={() => { setCall(null); setLeft(true); }} />;
  if (now === null) return null;
  if (now < new Date(opensAt).getTime()) return <p className="text-sm text-muted">{t('opensAt', { time: formatWhen(locale, opensAt, timeZone) })}</p>;
  if (now > new Date(closesAt).getTime()) return <p className="text-sm text-muted">{t('closed')}</p>;
  return (
    <div className="space-y-2">
      {left && <p role="status" className="text-sm">{t('leftNote')}</p>}
      <button type="button" disabled={join.pending} aria-busy={join.pending} onClick={join.fire} className={PRIMARY}>{t(left ? 'rejoin' : 'join')}<Arrow /></button>
      <ErrorText code={join.error} />
    </div>
  );
}

// --- Notifications

export function NotificationsList({ items, timeZone }: { items: { id: string; kind: string; params: { job_ar?: string; job_en?: string }; link: string; read_at: string | null; created_at: string }[]; timeZone: string }) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const readAll = useAction(readAllNotifications);
  if (items.length === 0) return <p className="text-muted">{t('empty')}</p>;
  return (
    <div>
      {items.some((n) => !n.read_at) && <button type="button" disabled={readAll.pending} onClick={readAll.fire} className="mb-4 font-semibold text-primary underline underline-offset-4">{t('readAll')}</button>}
      <ErrorText code={readAll.error} />
      <ul className="border-t border-border">
        {items.map((n) => (
          <li key={n.id} className="border-b border-border">
            <button
              type="button"
              onClick={async () => { if (!n.read_at) await readNotification(n.id); router.push(n.link); }}
              className={clsx('block w-full py-4 text-start transition-colors hover:text-primary', !n.read_at && 'font-semibold')}
            >
              {!n.read_at && <span className="me-2 inline-block size-2 rounded-full bg-primary" aria-label={t('unread')} />}
              {t(`kind.${n.kind}`, { job: pick(locale, n.params.job_ar ?? '', n.params.job_en ?? '') })}
              <span className="mt-1 block text-sm font-normal text-muted">{formatWhen(locale, n.created_at, timeZone)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Career development

type Family = { sector_code: string; job_family_ar: string; skills: number };

export function CareerTargetPicker({ families, target }: { families: Family[]; target: { sector_code: string; job_family_ar: string } | null }) {
  const t = useTranslations('development');
  const ts = useTranslations('sectors');
  const [sector, setSector] = useState(target?.sector_code ?? '');
  const [family, setFamily] = useState(target?.job_family_ar ?? '');
  const { pending, error, fire } = useAction(() => setCareerTarget(sector, family));
  const options = families.filter((f) => f.sector_code === sector);
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <label className="block">
        <span className="text-sm font-medium">{t('sector')}</span>
        <select value={sector} required onChange={(e) => { setSector(e.target.value); setFamily(''); }} className={INPUT}>
          <option value="">{t('choose')}</option>
          {SECTOR_KEYS.map((k) => <option key={k} value={k}>{ts(k)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t('family')}</span>
        <select value={family} required disabled={!sector} onChange={(e) => setFamily(e.target.value)} className={INPUT}>
          <option value="">{t('choose')}</option>
          {options.map((f) => <option key={f.job_family_ar} value={f.job_family_ar}>{f.job_family_ar}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending || !family} aria-busy={pending} className={clsx(PRIMARY, 'disabled:opacity-60')}>{t('setTarget')}</button>
      <div className="sm:col-span-3"><ErrorText code={error} /></div>
    </form>
  );
}

export function SavePlanButton({ skillId, kind, resourceId, saved, label }: { skillId: string; kind: string; resourceId?: string; saved: boolean; label: string }) {
  const t = useTranslations('development');
  const { pending, error, fire } = useAction(() => addPlanItem({ reference_skill_id: skillId, kind, ...(resourceId && { resource_id: resourceId }) }));
  if (saved) return <span className="text-sm font-medium text-primary">{t('saved')}</span>;
  return (
    <span>
      <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className="text-sm font-semibold underline underline-offset-4 disabled:opacity-60">{label}</button>
      <ErrorText code={error} />
    </span>
  );
}

export function PlanItemControls({ id, status, label }: { id: string; status: string; label: string }) {
  const t = useTranslations('development');
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label>
        <span className="sr-only">{t('progressOf', { item: label })}</span>
        <select
          value={value} disabled={pending} className="h-10 rounded-lg border border-border bg-surface px-2 text-sm"
          onChange={(e) => { const next = e.target.value; setValue(next); start(async () => setError((await setPlanStatus(id, next)).error)); }}
        >
          {['not_started', 'in_progress', 'completed'].map((k) => <option key={k} value={k}>{t(`status.${k}`)}</option>)}
        </select>
      </label>
      <button type="button" disabled={pending} onClick={() => start(async () => setError((await removePlanItem(id)).error))} className="text-sm text-muted underline underline-offset-4">{t('remove')}</button>
      <ErrorText code={error} />
    </div>
  );
}

// --- Settings

const TIME_ZONES = ['Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Qatar', 'Africa/Cairo', 'Europe/London', 'UTC'];

export function SettingsForm({ fullName, timeZone, reminders }: { fullName: string; timeZone: string; reminders: boolean }) {
  const t = useTranslations('settings');
  const [zone, setZone] = useState(timeZone);
  const [remind, setRemind] = useState(reminders);
  const [saved, setSaved] = useState(false);
  const { pending, error, fire } = useAction(async () => {
    const result = await saveSettings({ full_name: fullName, time_zone: zone, notification_prefs: { deadline_reminders: remind } });
    setSaved(Boolean(result.ok));
    return result;
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <label className="block max-w-sm">
        <span className="text-sm font-medium">{t('timeZone')}</span>
        <select value={zone} onChange={(e) => setZone(e.target.value)} className={INPUT} dir="ltr">
          {[...new Set([timeZone, ...TIME_ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        <span>{t('deadlineReminders')}</span>
      </label>
      <p className="text-sm text-muted">{t('emailNote')}</p>
      <ErrorText code={error} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('save')}</button>
        {saved && !pending && <span role="status" className="font-semibold text-primary">{t('saved')}</span>}
      </div>
    </form>
  );
}
