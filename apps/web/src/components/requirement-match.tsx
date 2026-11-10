'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { reviewRequirementMatch } from '@/lib/candidate-actions';
import { number, pick } from '@/lib/format';
import { ErrorText } from './forms';

export type MatchStatus = 'matched' | 'partial' | 'missing' | 'needs_review';
export type RequirementRow = {
  key: string; kind: string; text_ar: string | null; text_en: string | null; mandatory: boolean; min_years: number | null;
  proposal: { status: MatchStatus; score: number; evidence_text: string | null; evidence_source: string | null; counter_evidence_text?: string | null; reason_code: string; reason_params: Record<string, number> } | null;
  review?: { status: MatchStatus; decision: 'confirmed' | 'corrected'; note: string | null; created_at: string } | null;
  /** ATS stage 3: the model's reading of the evidence. Shown beside the matcher's status; it never changes the score. */
  ai_review?: AiReading | null;
};
export type AiReading = {
  reading: 'confirmed' | 'partial' | 'missing' | 'insufficient_evidence' | 'needs_manual_review';
  evidence: { id: string; source: string; text: string }[];
  relevant_experience_en: string; relevant_experience_ar: string; explanation_en: string; explanation_ar: string;
  missing_en: string; missing_ar: string; confidence: number; agrees: boolean; manual_review: boolean;
};
export type MatchData = {
  requirements: RequirementRow[];
  summary: { counts: Record<MatchStatus, number>; score: number | null; mandatory_missing: number } | null;
  evidence_lines: number;
  reviewed: number;
  provenance: { provider: string; model_version: string; fallback?: string } | null;
  /** The stored evaluation's state: computing in the background, ready, or unavailable (with a retry later). */
  evaluation?: 'ready' | 'computing' | 'unavailable' | 'none';
  ai_review?: { state: 'ready'; counts: Record<string, number>; provenance: { provider?: string; model_version?: string } } | { state: 'pending' } | { state: 'unavailable'; reason: string } | null;
};

const STATUSES: MatchStatus[] = ['matched', 'partial', 'missing', 'needs_review'];
const TONE: Record<MatchStatus, string> = {
  matched: 'border-primary/40 bg-success-surface text-primary',
  partial: 'border-gold/50 bg-warning-surface text-warning',
  missing: 'border-dashed border-border-strong text-muted',
  needs_review: 'border-info/40 bg-info-surface text-info',
};

/**
 * MIDAN's proposed match of the submitted profile against the job's requirements, for the organization's staff. Each
 * proposal shows the evidence line it used and why; staff confirm or correct it. A proposal is never a decision, and a
 * review never changes the application's status.
 */
export function RequirementMatch({ orgId, applicationId, data, canReview }: { orgId: string; applicationId: string; data: MatchData; canReview: boolean }) {
  const t = useTranslations('match');
  const locale = useLocale();
  const n = (v: number) => number(locale, v);
  const current = (r: RequirementRow) => r.review?.status ?? r.proposal?.status ?? 'needs_review';
  if (data.requirements.length === 0) return <p className="text-sm text-muted">{t('noRequirements')}</p>;
  // Not evaluated yet: say so, and show the requirements without any status rather than a "needs review" for each.
  if (data.evaluation === 'computing' || data.evaluation === 'unavailable') {
    return (
      <div className="space-y-3">
        <p role="status" className="callout text-sm">{t(data.evaluation === 'computing' ? 'evaluating' : 'evaluationUnavailable')}</p>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
          {data.requirements.map((r) => <li key={r.key}><bdi>{locale === 'ar' ? r.text_ar ?? r.text_en : r.text_en ?? r.text_ar}</bdi></li>)}
        </ul>
      </div>
    );
  }
  const counts = Object.fromEntries(STATUSES.map((s) => [s, data.requirements.filter((r) => current(r) === s).length])) as Record<MatchStatus, number>;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
        <p className="text-center md:text-start">
          <span className="num font-display text-5xl font-bold">{data.summary?.score == null ? '—' : n(data.summary.score)}</span>
          {data.summary?.score != null && <span className="num font-display text-2xl text-muted"> / {n(100)}</span>}
          <span className="mt-1 block max-w-[14rem] text-xs text-muted">{t('scoreNote')}</span>
        </p>
        <div>
          <ul className="flex flex-wrap gap-2">
            {STATUSES.map((s) => <li key={s} className={clsx('chip text-sm', TONE[s])}>{t(`status.${s}`)} <span className="num font-semibold">{n(counts[s])}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">{t('reviewedCount', { reviewed: n(data.reviewed), total: n(data.requirements.length) })}</p>
          {(data.summary?.mandatory_missing ?? 0) > 0 && <p className="mt-1 text-sm font-medium text-warning">{t('mandatoryMissing', { count: data.summary!.mandatory_missing })}</p>}
        </div>
      </div>
      {data.ai_review && (
        <p role="status" className="text-sm text-muted">
          {data.ai_review.state === 'ready'
            ? t('ai.ready', { model: data.ai_review.provenance.model_version ?? '', review: n(data.ai_review.counts.manual_review ?? 0) })
            : data.ai_review.state === 'pending' ? t('ai.pending') : t('ai.unavailable')}
        </p>
      )}
      <ol className="divide-y divide-border border-y border-border">
        {data.requirements.map((r) => <Row key={r.key} orgId={orgId} applicationId={applicationId} row={r} canReview={canReview} />)}
      </ol>
      <p className="text-xs leading-relaxed text-muted">{t('provenance')}{data.provenance?.fallback ? ` ${t('fallback')}` : ''}</p>
    </div>
  );
}

function Row({ orgId, applicationId, row, canReview }: { orgId: string; applicationId: string; row: RequirementRow; canReview: boolean }) {
  const t = useTranslations('match');
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [correcting, setCorrecting] = useState(false);
  const [choice, setChoice] = useState<MatchStatus>(row.proposal?.status ?? 'needs_review');
  const [note, setNote] = useState('');
  const proposed = row.proposal?.status ?? 'needs_review';
  const shown = row.review?.status ?? proposed;
  const label = pick(locale, row.text_ar ?? row.text_en ?? '', row.text_en ?? row.text_ar ?? '');
  const send = (status: MatchStatus) => start(async () => {
    const result = await reviewRequirementMatch(orgId, applicationId, { requirement_key: row.key, status, proposed_status: proposed, ...(note.trim() && { note: note.trim() }) });
    setError(result.error);
    if (!result.error) { setCorrecting(false); setNote(''); }
  });
  const reason = row.proposal ? t(`reason.${row.proposal.reason_code}`, { min: row.proposal.reason_params.min_years ?? 0, years: row.proposal.reason_params.years ?? 0, source: row.proposal.evidence_source ? t(`source.${row.proposal.evidence_source.replace(/[^a-z_]/g, '')}`) : '' }) : t('noProposal');
  return (
    <li className="grid gap-3 py-4 lg:grid-cols-[9rem_minmax(0,1fr)] lg:gap-6">
      <div className="flex flex-wrap items-start gap-2 lg:flex-col">
        <span className={clsx('chip text-xs font-semibold', TONE[shown])}>{t(`status.${shown}`)}</span>
        {row.review && <span className="text-xs text-muted">{t(`decision.${row.review.decision}`)}</span>}
      </div>
      <div className="min-w-0">
        <p className="font-semibold leading-snug" dir="auto">
          {label}
          <span className="ms-2 text-xs font-normal text-muted">{t(`kind.${row.kind}`)}{row.mandatory ? ` · ${t('mandatory')}` : ` · ${t('optional')}`}</span>
        </p>
        {row.proposal?.evidence_text && (
          <blockquote className="mt-2 border-s-2 border-gold ps-3 text-sm leading-relaxed" dir="auto">
            <span className="block text-xs font-semibold text-gold-text">{t(`source.${(row.proposal.evidence_source ?? '').replace(/[^a-z_]/g, '')}`)}</span>
            {row.proposal.evidence_text}
          </blockquote>
        )}
        {row.proposal?.counter_evidence_text && (
          <blockquote className="mt-2 border-s-2 border-error ps-3 text-sm leading-relaxed" dir="auto">
            <span className="block text-xs font-semibold text-error">{t('counter')}</span>
            {row.proposal.counter_evidence_text}
          </blockquote>
        )}
        <p className="mt-2 text-sm text-muted">{reason}{row.proposal && row.proposal.reason_code !== 'listed_skill' && row.proposal.reason_code !== 'too_short' ? ` ${t('similarity', { score: number(locale, Math.round(row.proposal.score * 100)) })}` : ''}</p>
        {row.ai_review && <AiReadingView reading={row.ai_review} />}
        {row.review?.note && <p className="mt-1 text-sm" dir="auto"><span className="font-semibold">{t('noteLabel')}: </span>{row.review.note}</p>}
        {canReview && (
          <div className="mt-3">
            {!correcting ? (
              <div className="flex flex-wrap items-center gap-3">
                {(!row.review || row.review.status !== proposed) && (
                  <button type="button" disabled={pending} aria-busy={pending} onClick={() => send(proposed)} className="btn btn-secondary btn-sm">{t('confirm', { status: t(`status.${proposed}`) })}</button>
                )}
                <button type="button" disabled={pending} onClick={() => setCorrecting(true)} className="text-sm font-semibold underline underline-offset-4">{t('correct')}</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2/40 p-3">
                <label className="text-sm">
                  <span className="field-label">{t('correctTo')}</span>
                  <select value={choice} onChange={(e) => setChoice(e.target.value as MatchStatus)} className="input mt-0 h-9">
                    {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                  </select>
                </label>
                <label className="min-w-[12rem] flex-1 text-sm">
                  <span className="field-label">{t('noteLabel')}</span>
                  <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} dir="auto" className="input mt-0 h-9" />
                </label>
                <button type="button" disabled={pending} aria-busy={pending} onClick={() => send(choice)} className="btn btn-primary btn-sm">{t('save')}</button>
                <button type="button" onClick={() => setCorrecting(false)} className="btn btn-ghost btn-sm">{t('cancel')}</button>
              </div>
            )}
            <ErrorText code={error} />
          </div>
        )}
      </div>
    </li>
  );
}

/** ATS stage 3 for one requirement: the model's reading, the experience it rests on, what's missing, and whether a person should check it. */
function AiReadingView({ reading }: { reading: AiReading }) {
  const t = useTranslations('match');
  const locale = useLocale();
  const say = (en: string, ar: string) => pick(locale, ar || en, en || ar);
  const experience = say(reading.relevant_experience_en, reading.relevant_experience_ar);
  const missing = say(reading.missing_en, reading.missing_ar);
  return (
    <div className="mt-3 rounded-[var(--radius-control)] border border-border bg-surface-2/40 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('ai.title')}</span>
        <span className="font-semibold">{t(`ai.reading.${reading.reading}`)}</span>
        <span className="num text-xs text-muted">{t('ai.confidence', { value: number(locale, Math.round(reading.confidence * 100)) })}</span>
        {reading.manual_review && <span className="chip border-info/40 bg-info-surface text-xs text-info">{t('ai.manual')}</span>}
      </p>
      <p className="mt-1.5 leading-relaxed" dir="auto">{say(reading.explanation_en, reading.explanation_ar)}</p>
      {experience && <p className="mt-1 text-muted" dir="auto"><span className="font-semibold text-fg">{t('ai.experience')}: </span>{experience}</p>}
      {missing && <p className="mt-1 text-muted" dir="auto"><span className="font-semibold text-fg">{t('ai.missing')}: </span>{missing}</p>}
      {reading.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reading.evidence.map((e) => (
            <li key={e.id} className="border-s-2 border-border-strong ps-3 text-xs leading-relaxed" dir="auto">
              <span className="font-semibold">{t(`source.${e.source.replace(/[^a-z_]/g, '')}`)}: </span>{e.text}
            </li>
          ))}
        </ul>
      )}
      {!reading.agrees && <p className="mt-2 text-xs text-muted">{t('ai.disagrees')}</p>}
    </div>
  );
}

/**
 * The candidate's own view: how their profile relates to each of a job's requirements, with the line that shows it. For
 * guidance only: it doesn't affect any application, and similarity isn't proof of a skill.
 */
export function CandidateRequirementMatch({ requirements }: { requirements: RequirementRow[] }) {
  const t = useTranslations('match');
  const locale = useLocale();
  const shown = (r: RequirementRow) => r.proposal?.status ?? 'needs_review';
  return (
    <ol className="mt-3 divide-y divide-border border-y border-border">
      {requirements.map((r) => {
        const p = r.proposal;
        const source = p?.evidence_source ? t(`source.${p.evidence_source.replace(/[^a-z_]/g, '')}`) : '';
        return (
          <li key={r.key} className="py-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className={clsx('chip text-xs font-semibold', TONE[shown(r)])}>{t(`candidateStatus.${shown(r)}`)}</span>
              <span className="font-semibold" dir="auto">{pick(locale, r.text_ar ?? r.text_en ?? '', r.text_en ?? r.text_ar ?? '')}</span>
            </p>
            {p?.evidence_text && <p className="mt-1.5 border-s-2 border-gold ps-3 text-sm" dir="auto"><span className="text-xs font-semibold text-gold-text">{source}: </span>{p.evidence_text}</p>}
            {p?.counter_evidence_text && <p className="mt-1.5 border-s-2 border-error ps-3 text-sm" dir="auto"><span className="text-xs font-semibold text-error">{t('counter')}: </span>{p.counter_evidence_text}</p>}
            {p && <p className="mt-1 text-xs text-muted">{t(`reason.${p.reason_code}`, { min: p.reason_params.min_years ?? 0, years: p.reason_params.years ?? 0, source })}</p>}
          </li>
        );
      })}
    </ol>
  );
}
