'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { addApplicationNote, saveInterviewFeedback } from '@/lib/candidate-actions';
import { formatDate, number } from '@/lib/format';
import { ErrorText, INPUT, PRIMARY } from './forms';

const ZONE = 'Asia/Riyadh';

type Note = { id: string; body: string; created_at: string; authorName: string };

/** The organization's notes: kept as written, newest first. The candidate never sees them. */
export function ApplicationNotes({ orgId, applicationId, notes }: { orgId: string; applicationId: string; notes: Note[] }) {
  const t = useTranslations('applicant');
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    const body = String(new FormData(target).get('body') ?? '').trim();
    if (!body) return setError('required');
    start(async () => {
      const result = await addApplicationNote(orgId, applicationId, body);
      setError(result.error);
      if (result.ok) target.reset();
    });
  }
  return (
    <section aria-labelledby="notes">
      <h2 id="notes" className="section-title">{t('notesTitle')}</h2>
      <p className="mt-1 text-sm text-muted">{t('notesNote')}</p>
      <form className="mt-3 max-w-3xl space-y-2" onSubmit={add}>
        <label className="block">
          <span className="field-label">{t('noteLabel')}</span>
          <textarea name="body" required maxLength={4000} rows={3} className={`${INPUT} h-auto py-2`} />
        </label>
        <ErrorText code={error} />
        <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('addNote')}</button>
      </form>
      {notes.length === 0 ? <p className="mt-4 text-muted">{t('notesEmpty')}</p> : (
        <ul className="mt-4 border-t border-border">
          {notes.map((n) => (
            <li key={n.id} className="border-b border-border py-3">
              <p className="whitespace-pre-line"><bdi>{n.body}</bdi></p>
              <p className="mt-1 text-sm text-muted">{n.authorName} · {formatDate(locale, n.created_at, ZONE)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Competency = { label: string; rating: number | null; evidence: string };
type Feedback = { status: 'draft' | 'submitted'; recommendation: string | null; notes: string | null; submitted_at: string | null; competencies: Competency[] };
const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;

function Submitted({ feedback }: { feedback: Feedback & { authorName: string } }) {
  const t = useTranslations('applicant');
  const locale = useLocale();
  return (
    <div className="mt-3 rounded-lg bg-surface p-4 text-sm">
      <p className="font-semibold">{feedback.authorName} · {feedback.recommendation && t(`recommendation.${feedback.recommendation}`)}</p>
      {feedback.submitted_at && <p className="text-muted">{t('submittedOn', { date: formatDate(locale, feedback.submitted_at, ZONE) })}</p>}
      <ul className="mt-2 space-y-1">
        {feedback.competencies.map((c, i) => (
          <li key={i}><span className="font-medium"><bdi>{c.label}</bdi></span>: {c.rating != null ? `${number(locale, c.rating)} / ${number(locale, 4)}` : '—'}{c.evidence && <> · <bdi>{c.evidence}</bdi></>}</li>
        ))}
      </ul>
      {feedback.notes && <p className="mt-2 whitespace-pre-line"><bdi>{feedback.notes}</bdi></p>}
    </div>
  );
}

/**
 * One interviewer's feedback: saved as a draft only they can see, then submitted for good. Separate from MIDAN's
 * assessment, and never a decision: the hiring decision is issued by a person in the decision panel.
 */
export function InterviewFeedback({ orgId, applicationId, interviewId, canWrite, mine, submitted, suggested }: {
  orgId: string; applicationId: string; interviewId: string; canWrite: boolean;
  mine: Feedback | null; submitted: (Feedback & { authorName: string })[];
  /** The job's required skills, as a starting list. Interviewers can change or add to it. */
  suggested: string[];
}) {
  const t = useTranslations('applicant');
  const start0 = suggested.length ? suggested.slice(0, 20).map((label) => ({ label, rating: null, evidence: '' })) : [{ label: '', rating: null, evidence: '' }];
  const [rows, setRows] = useState<Competency[]>(mine?.competencies.length ? mine.competencies : start0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const set = (i: number, patch: Partial<Competency>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  function save(status: 'draft' | 'submitted', form: HTMLFormElement) {
    const data = new FormData(form);
    const competencies = rows.filter((r) => r.label.trim()).map((r) => ({ label: r.label.trim(), ...(r.rating && { rating: r.rating }), evidence: r.evidence.trim() }));
    const recommendation = String(data.get('recommendation') ?? '') || undefined;
    if (status === 'submitted' && (!recommendation || competencies.length === 0 || competencies.some((c) => !c.rating))) return setError('feedback_incomplete');
    start(async () => {
      const result = await saveInterviewFeedback(orgId, applicationId, interviewId, {
        status, competencies, ...(recommendation && { recommendation }), ...(String(data.get('notes') ?? '').trim() && { notes: String(data.get('notes')).trim() }),
      });
      setError(result.error);
      setSaved(result.ok ? status : undefined);
    });
  }

  return (
    <div>
      {submitted.length === 0 && !canWrite && <p className="mt-2 text-sm text-muted">{t('feedbackNone')}</p>}
      {submitted.map((f, i) => <Submitted key={i} feedback={f} />)}
      {/* Lasting confirmation: once submitted, the form is gone, so its own message would vanish with it. */}
      {canWrite && mine?.status === 'submitted' && <p role="status" className="mt-2 text-sm font-semibold text-primary">{t('feedbackSubmitted')}</p>}
      {canWrite && mine?.status !== 'submitted' && (
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save('submitted', e.currentTarget); }}>
          <p className="text-sm font-semibold">{mine ? t('feedbackDraft') : t('feedbackYours')}</p>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t('competencies')}</legend>
            {rows.map((row, i) => (
              <div key={i} role="group" aria-label={t('competencyN', { n: i + 1 })} className="grid gap-2 sm:grid-cols-[2fr_1fr_3fr]">
                <label className="block"><span className="text-sm">{t('competencyLabel')}</span>
                  <input value={row.label} maxLength={300} onChange={(e) => set(i, { label: e.target.value })} className={INPUT} /></label>
                <label className="block"><span className="text-sm">{t('rating')}</span>
                  <select value={row.rating ?? ''} onChange={(e) => set(i, { rating: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
                    <option value="">{t('choose')}</option>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{t(`ratingLevel.${n}`)}</option>)}
                  </select></label>
                <label className="block"><span className="text-sm">{t('evidenceLabel')}</span>
                  <input value={row.evidence} maxLength={2000} onChange={(e) => set(i, { evidence: e.target.value })} className={INPUT} /></label>
              </div>
            ))}
            {rows.length < 20 && <button type="button" onClick={() => setRows((r) => [...r, { label: '', rating: null, evidence: '' }])} className="text-sm font-semibold underline underline-offset-4">{t('addCompetency')}</button>}
          </fieldset>
          <label className="block max-w-sm"><span className="field-label">{t('recommendationLabel')}</span>
            <select name="recommendation" defaultValue={mine?.recommendation ?? ''} className={INPUT}>
              <option value="">{t('choose')}</option>
              {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{t(`recommendation.${r}`)}</option>)}
            </select></label>
          <p className="text-sm text-muted">{t('recommendationNote')}</p>
          <label className="block"><span className="field-label">{t('feedbackNotes')}</span>
            <textarea name="notes" maxLength={8000} rows={4} defaultValue={mine?.notes ?? ''} className={`${INPUT} h-auto py-2`} /></label>
          <ErrorText code={error} />
          {saved === 'draft' && <p role="status" className="text-sm font-semibold text-primary">{t('draftSaved')}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending} onClick={(e) => save('draft', e.currentTarget.form!)} className="btn btn-secondary">{t('saveDraft')}</button>
            <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('submitFeedback')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
