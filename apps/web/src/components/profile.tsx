'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { applicantCvLink, myCvLink, removeCv, saveProfile, uploadCv, type ProfilePayload } from '@/lib/actions';
import { CvAnalysisStatus } from './candidate';
import { ErrorText, Field, INPUT, openFileLink, PRIMARY } from './forms';
import type { CvAnalysis } from '@/lib/candidate-actions';

type Row = Record<string, string>;

export type ProfileData = {
  full_name?: string; headline?: string | null; city?: string | null; summary?: string | null; years_experience?: string | number | null;
  share_profile_consent?: boolean; cv_path?: string | null;
  education?: Record<string, unknown>[]; experience?: Record<string, unknown>[];
  phone?: string | null; projects?: Record<string, unknown>[]; courses?: Record<string, unknown>[]; certifications?: Record<string, unknown>[]; self_reported_skills?: string[];
} | null;

const toRows = (items: Record<string, unknown>[] = []): Row[] =>
  items.map((item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v == null ? '' : String(v)])));

const year = (value: string) => (value ? Number(value) : null);
const titled = (r: Row) => ({
  title: r.title.trim(),
  ...(r.description?.trim() && { description: r.description.trim() }),
  ...(r.issuer?.trim() && { issuer: r.issuer.trim() }),
  year: year(r.year),
});

function RowList({ title, addLabel, rows, setRows, blank, children }: {
  title: string; addLabel: string; rows: Row[]; setRows: (rows: Row[]) => void; blank: Row;
  children: (row: Row, update: (key: string, value: string) => void) => React.ReactNode;
}) {
  const t = useTranslations('profile');
  const [keys, setKeys] = useState(() => rows.map((_, i) => i));
  const [next, setNext] = useState(rows.length);
  return (
    <fieldset>
      <legend className="subsection-title">{title}</legend>
      <ul className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {rows.map((row, i) => (
            <motion.li key={keys[i]} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg bg-surface p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {children(row, (key, value) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r))))}
              </div>
              <button
                type="button"
                onClick={() => { setRows(rows.filter((_, j) => j !== i)); setKeys(keys.filter((_, j) => j !== i)); }}
                className="mt-3 text-sm font-medium text-muted underline underline-offset-4 hover:text-foreground"
              >
                {t('remove')}
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button
        type="button"
        onClick={() => { setRows([...rows, blank]); setKeys([...keys, next]); setNext(next + 1); }}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-2"
      >
        <span aria-hidden>+</span>{addLabel}
      </button>
    </fieldset>
  );
}

function YearFields({ row, update, optionalEnd = true }: { row: Row; update: (key: string, value: string) => void; optionalEnd?: boolean }) {
  const t = useTranslations('profile');
  return (
    <>
      <Field name="start_year" type="number" min={1950} max={2100} required label={t('startYear')} value={row.start_year ?? ''} onChange={(e) => update('start_year', e.target.value)} />
      <Field name="end_year" type="number" min={1950} max={2100} label={t('endYear')} hint={optionalEnd ? t('endYearHint') : undefined} value={row.end_year ?? ''} onChange={(e) => update('end_year', e.target.value)} />
    </>
  );
}

export function ProfileForm({ profile, selected, fallbackName }: { profile: ProfileData; selected: string[]; fallbackName: string }) {
  const t = useTranslations('profile');
  const [name, setName] = useState(profile?.full_name ?? fallbackName);
  const [headline, setHeadline] = useState(profile?.headline ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [summary, setSummary] = useState(profile?.summary ?? '');
  const [years, setYears] = useState(profile?.years_experience == null ? '' : String(Number(profile.years_experience)));
  const [consent, setConsent] = useState(profile?.share_profile_consent ?? false);
  const [experience, setExperience] = useState(() => toRows(profile?.experience));
  const [education, setEducation] = useState(() => toRows(profile?.education));
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [projects, setProjects] = useState(() => toRows(profile?.projects));
  const [courses, setCourses] = useState(() => toRows(profile?.courses));
  const [certifications, setCertifications] = useState(() => toRows(profile?.certifications));
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ error?: string; ok?: boolean }>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: ProfilePayload = {
      full_name: name.trim(), headline: headline.trim() || null, city: city.trim() || null, summary: summary.trim() || null,
      years_experience: years === '' ? null : Number(years), share_profile_consent: consent,
      phone: phone.trim() || null,
      experience: experience.map((r) => ({
        title: r.title.trim(), start_year: year(r.start_year), end_year: year(r.end_year),
        ...(r.organization?.trim() && { organization: r.organization.trim() }),
        ...(r.description?.trim() && { description: r.description.trim() }),
      })),
      education: education.map((r) => ({
        qualification: r.qualification.trim(), start_year: year(r.start_year), end_year: year(r.end_year),
        ...(r.institution?.trim() && { institution: r.institution.trim() }),
        ...(r.field?.trim() && { field: r.field.trim() }),
      })),
      projects: projects.map(titled),
      courses: courses.map(titled),
      certifications: certifications.map(titled),
      skill_ids: selected,
    };
    setStatus({});
    start(async () => setStatus(await saveProfile(payload)));
  }

  return (
    <form onSubmit={submit} className="space-y-10">
      <fieldset className="space-y-4">
        <legend className="subsection-title">{t('basics')}</legend>
        <Field name="full_name" required maxLength={200} autoComplete="name" label={t('fullName')} value={name} onChange={(e) => setName(e.target.value)} />
        <Field name="headline" maxLength={200} label={t('headline')} value={headline} onChange={(e) => setHeadline(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="phone" type="tel" dir="ltr" maxLength={30} autoComplete="tel" label={t('phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Field name="city" maxLength={100} label={t('city')} value={city} onChange={(e) => setCity(e.target.value)} />
          <Field name="years_experience" type="number" min={0} max={70} step={0.5} label={t('years')} value={years} onChange={(e) => setYears(e.target.value)} />
        </div>
        <label className="block">
          <span className="text-sm font-medium">{t('summary')}</span>
          <textarea rows={3} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} aria-describedby="summary-hint" className={clsx(INPUT, 'h-auto py-2.5 leading-relaxed')} />
          <span id="summary-hint" className="mt-1 block text-xs text-muted">{t('summaryHint')}</span>
        </label>
      </fieldset>

      <RowList title={t('experience')} addLabel={t('addExperience')} rows={experience} setRows={setExperience} blank={{ title: '', organization: '', start_year: '', end_year: '', description: '' }}>
        {(row, update) => (
          <>
            <Field name="title" required maxLength={200} label={t('jobTitle')} value={row.title ?? ''} onChange={(e) => update('title', e.target.value)} />
            <Field name="organization" maxLength={200} label={t('organization')} value={row.organization ?? ''} onChange={(e) => update('organization', e.target.value)} />
            <YearFields row={row} update={update} />
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">{t('description')}</span>
              <textarea rows={2} maxLength={2000} value={row.description ?? ''} onChange={(e) => update('description', e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
            </label>
          </>
        )}
      </RowList>

      <RowList title={t('education')} addLabel={t('addEducation')} rows={education} setRows={setEducation} blank={{ institution: '', qualification: '', field: '', start_year: '', end_year: '' }}>
        {(row, update) => (
          <>
            <Field name="institution" maxLength={200} label={t('institution')} value={row.institution ?? ''} onChange={(e) => update('institution', e.target.value)} />
            <Field name="qualification" required maxLength={200} label={t('qualification')} value={row.qualification ?? ''} onChange={(e) => update('qualification', e.target.value)} />
            <div className="sm:col-span-2"><Field name="field" maxLength={200} label={t('field')} value={row.field ?? ''} onChange={(e) => update('field', e.target.value)} /></div>
            <YearFields row={row} update={update} />
          </>
        )}
      </RowList>

      <RowList title={t('projects')} addLabel={t('addProject')} rows={projects} setRows={setProjects} blank={{ title: '', description: '' }}>
        {(row, update) => (
          <>
            <Field name="project_title" required maxLength={300} label={t('projectTitle')} value={row.title ?? ''} onChange={(e) => update('title', e.target.value)} />
            <Field name="project_description" maxLength={2000} label={t('description')} value={row.description ?? ''} onChange={(e) => update('description', e.target.value)} />
          </>
        )}
      </RowList>

      <RowList title={t('courses')} addLabel={t('addCourse')} rows={courses} setRows={setCourses} blank={{ title: '', issuer: '', year: '' }}>
        {(row, update) => (
          <>
            <Field name="course_title" required maxLength={300} label={t('courseTitle')} value={row.title ?? ''} onChange={(e) => update('title', e.target.value)} />
            <Field name="course_issuer" maxLength={200} label={t('issuer')} value={row.issuer ?? ''} onChange={(e) => update('issuer', e.target.value)} />
          </>
        )}
      </RowList>

      <RowList title={t('certifications')} addLabel={t('addCertification')} rows={certifications} setRows={setCertifications} blank={{ title: '', issuer: '', year: '' }}>
        {(row, update) => (
          <>
            <Field name="certification_title" required maxLength={300} label={t('certificationTitle')} value={row.title ?? ''} onChange={(e) => update('title', e.target.value)} />
            <Field name="certification_issuer" maxLength={200} label={t('issuer')} value={row.issuer ?? ''} onChange={(e) => update('issuer', e.target.value)} />
          </>
        )}
      </RowList>

      <fieldset>
        <legend className="subsection-title">{t('sharing')}</legend>
        <label className="mt-3 flex items-start gap-3 rounded-lg bg-surface p-4">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            <span className="block text-sm font-medium">{t('consent')}</span>
            <span className="mt-1 block text-xs text-muted">{t('consentHint')}</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
          {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
          {t('save')}
        </button>
        {status.ok && <motion.span role="status" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="font-semibold text-primary">{t('saved')}</motion.span>}
      </div>
      <ErrorText code={status.error} />
    </form>
  );
}

export function CvPanel({ hasCv, hasProfile, analysis }: { hasCv: boolean; hasProfile: boolean; analysis?: CvAnalysis | null }) {
  const t = useTranslations('profile');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  function upload(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setError('too_large');
    if (!/\.(pdf|docx)$/i.test(file.name)) return setError('cv_type');
    const form = new FormData();
    form.append('file', file);
    setError(undefined);
    start(async () => setError((await uploadCv(form)).error));
  }

  return (
    <section aria-labelledby="cv" className="rounded-lg bg-surface p-5">
      <h2 id="cv" className="subsection-title">{t('cv')}</h2>
      <p className="mt-1 font-medium">{hasCv ? t('cvOnFile') : t('cvNone')}</p>
      <p className="mt-1 text-xs text-muted">{t('cvHint')}</p>
      {hasProfile ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={clsx('inline-flex cursor-pointer items-center rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-primary', pending && 'opacity-60')}>
            <input type="file" accept=".pdf,.docx" className="sr-only" disabled={pending} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            {pending ? t('uploading') : hasCv ? t('cvReplace') : t('cvUpload')}
          </label>
          {hasCv && (
            <>
              <button type="button" onClick={() => start(() => openFileLink(myCvLink, setError))} className="text-sm font-semibold text-primary underline underline-offset-4">{t('cvView')}</button>
              {confirming ? (
                <button type="button" disabled={pending} onClick={() => start(async () => { setError((await removeCv()).error); setConfirming(false); })} className="text-sm font-semibold text-error underline underline-offset-4">{t('cvRemove')}</button>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted underline underline-offset-4">{t('remove')}</button>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{t('cvSaveFirst')}</p>
      )}
      <div className="mt-2"><ErrorText code={error} /></div>
      {analysis !== undefined && <div className="mt-3"><CvAnalysisStatus analysis={analysis} compact /></div>}
    </section>
  );
}

export function ApplicantCvButton({ applicationId }: { applicationId: string }) {
  const t = useTranslations('applicant');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div>
      <button type="button" disabled={pending} aria-busy={pending} onClick={() => start(() => openFileLink(() => applicantCvLink(applicationId), setError))} className="rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:opacity-60">
        {t('cvOpen')}
      </button>
      <ErrorText code={error} />
    </div>
  );
}
