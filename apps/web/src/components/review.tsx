'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { evidenceLink, releaseResult, runEvaluation, submitReview } from '@/lib/actions';
import { number, pick } from '@/lib/format';
import { ErrorText, INPUT, openFileLink, PRIMARY, useAction } from './forms';

type Score = { criterion_id: string; score: string; source: string; evidence_ref: string | null; explanation: string | null; confidence: string | null };
type Criterion = { id: string; code: string; description_ar: string; description_en: string; max_score: string };
type Question = { id: string; prompt_ar: string; prompt_en: string; options: { id: string; label_ar: string; label_en: string }[] };
type Task = { id: string; title_ar: string; title_en: string; task_type: string; config: { questions?: Question[] }; rubric_criteria: Criterion[] };
export type ReviewData = {
  id: string; status: string;
  applications: { job_id: string; users: { candidate_profiles: { full_name: string } | null } | null };
  task_responses: { task_id: string; answer: { text?: string; choices?: Record<string, string> } }[];
  evidence_files: { id: string; task_id: string; file_name: string }[];
  assessment_versions: { assessment_tasks: Task[] };
  evaluation_results: {
    id: string; status: string; overall_score: string | null; ai_mode: string | null; review_reasons: string[]; released_to_candidate: boolean;
    criterion_scores: Score[];
    skill_scores: { level: number; skills: { name_ar: string; name_en: string } }[];
    evaluation_reviews: { id: string; notes: string | null }[];
  } | null;
};

export function RunEvaluation({ attemptId }: { attemptId: string }) {
  const t = useTranslations('review');
  const { pending, error, fire } = useAction(() => runEvaluation(attemptId));
  return (
    <div className="rounded-lg bg-surface p-5">
      <button type="button" onClick={fire} disabled={pending} aria-busy={pending} className={PRIMARY}>
        {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
        {t('run')}
      </button>
      <p className="mt-2 text-sm text-muted">{t('runNote')}</p>
      <ErrorText code={error} />
    </div>
  );
}

function EvidenceLink({ id, name }: { id: string; name: string }) {
  const t = useTranslations('review');
  const [error, setError] = useState<string>();
  return (
    <span>
      <button
        type="button"
        onClick={() => openFileLink(() => evidenceLink(id), setError)}
        className="font-semibold text-primary underline underline-offset-4"
      >
        {t('open')}: <span dir="ltr">{name}</span>
      </button>
      <ErrorText code={error} />
    </span>
  );
}

export function ReviewPanel({ data }: { data: ReviewData }) {
  const t = useTranslations('review');
  const locale = useLocale();
  const evaluation = data.evaluation_results;
  const reviewed = evaluation?.status === 'reviewed';
  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const approve = useAction(() => {
    const changed = Object.entries(scores)
      .filter(([, v]) => v !== '')
      .map(([criterion_id, v]) => ({ criterion_id, score: Number(v) }));
    return submitReview((evaluation as NonNullable<typeof evaluation>).id, changed, notes);
  });
  const release = useAction(() => releaseResult((evaluation as NonNullable<typeof evaluation>).id));
  const proposalFor = (id: string) => evaluation?.criterion_scores.find((s) => s.criterion_id === id && s.source !== 'human_reviewed');
  const humanFor = (id: string) => evaluation?.criterion_scores.find((s) => s.criterion_id === id && s.source === 'human_reviewed');
  const reasons = evaluation?.review_reasons ?? [];

  return (
    <div className="space-y-10">
      {evaluation?.ai_mode === 'demo' && <p className="border-s-2 border-gold ps-4 font-medium">{t('demoLabel')}</p>}
      {!reviewed && reasons.length > 0 && (
        <section className="rounded-lg bg-surface p-5">
          <h2 className="font-semibold">{t('reasons')}</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted">
            {[...new Set(reasons.map((r) => r.split(':')[0]))].map((r) => <li key={r}>{t(`reason.${r}`)}</li>)}
          </ul>
        </section>
      )}

      {data.assessment_versions.assessment_tasks.map((task) => {
        const response = data.task_responses.find((r) => r.task_id === task.id)?.answer;
        const files = data.evidence_files.filter((f) => f.task_id === task.id);
        return (
          <section key={task.id} aria-label={pick(locale, task.title_ar, task.title_en)} className="border-t border-border pt-6">
            <h2 className="font-display text-xl font-semibold">{pick(locale, task.title_ar, task.title_en)}</h2>
            <h3 className="mt-3 text-sm font-medium text-muted">{t('response')}</h3>
            {task.task_type === 'objective_questions' ? (
              <ul className="mt-1 space-y-2 text-sm">
                {(task.config.questions ?? []).map((q) => {
                  const chosen = q.options.find((o) => o.id === response?.choices?.[q.id]);
                  return (
                    <li key={q.id}>
                      <span className="font-medium">{pick(locale, q.prompt_ar, q.prompt_en)}</span>
                      <span className="block text-muted">{t('choice')}: {chosen ? pick(locale, chosen.label_ar, chosen.label_en) : t('noResponse')}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 rounded-lg bg-surface p-3.5 leading-relaxed whitespace-pre-line">{response?.text?.trim() || t('noResponse')}</p>
            )}
            {files.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="font-medium text-muted">{t('evidence')}</p>
                <ul className="mt-1 space-y-1">{files.map((f) => <li key={f.id}><EvidenceLink id={f.id} name={f.file_name} /></li>)}</ul>
              </div>
            )}

            {evaluation && (
              <ul className="mt-4 space-y-3">
                {task.rubric_criteria.map((c) => {
                  const proposal = proposalFor(c.id);
                  const human = humanFor(c.id);
                  return (
                    <li key={c.id} className="grid gap-3 rounded-lg border border-border p-3.5 sm:grid-cols-[1fr_8rem]">
                      <div>
                        <p className="font-medium">{pick(locale, c.description_ar, c.description_en)}</p>
                        {proposal ? (
                          <>
                            <p className="mt-1 text-sm">
                              <span className="font-semibold">{t('proposed')}: {number(locale, Number(proposal.score))} / {number(locale, Number(c.max_score))}</span>
                              <span className="text-muted"> · {t(`source.${proposal.source}`)}{proposal.confidence && ` · ${t('confidence', { value: number(locale, Math.round(Number(proposal.confidence) * 100)) })}`}</span>
                            </p>
                            {proposal.source === 'ai_assisted' && proposal.evidence_ref && proposal.evidence_ref !== 'no-evidence' && (
                              <p className="mt-1 border-s-2 border-border ps-3 text-sm text-muted"><span className="font-medium">{t('quote')}:</span> {proposal.evidence_ref}</p>
                            )}
                            {proposal.explanation && <p className="mt-1 text-xs text-muted" dir="auto">{proposal.explanation}</p>}
                          </>
                        ) : (
                          <p className="mt-1 text-sm font-medium text-error">{t('noProposal')}</p>
                        )}
                        {human && <p className="mt-1 text-sm font-semibold text-primary">{t('source.human_reviewed')}: {number(locale, Number(human.score))}</p>}
                      </div>
                      {!reviewed && (
                        <label>
                          <span className="text-sm font-medium">{t('yourScore')}</span>
                          <input
                            type="number" min="0" max={Number(c.max_score)} step="0.5"
                            required={!proposal}
                            placeholder={proposal ? String(Number(proposal.score)) : ''}
                            value={scores[c.id] ?? ''}
                            onChange={(e) => setScores((all) => ({ ...all, [c.id]: e.target.value }))}
                            className={clsx(INPUT, 'mt-1 h-10')}
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {evaluation && !reviewed && (
        <section className="border-t border-border pt-6">
          <label className="block">
            <span className="font-semibold">{t('notes')}</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
            <span className="mt-1 block text-xs text-muted">{t('notesHint')}</span>
          </label>
          <button type="button" onClick={approve.fire} disabled={approve.pending} aria-busy={approve.pending} className={clsx(PRIMARY, 'mt-4')}>{t('approve')}</button>
          <div className="mt-2"><ErrorText code={approve.error} /></div>
        </section>
      )}

      {evaluation && reviewed && (
        <section className="on-deep rounded-lg bg-deep p-6 text-deep-foreground">
          <h2 className="font-display text-2xl font-bold">{t('reviewedTitle')}</h2>
          <p className="mt-3 text-deep-muted">{t('overall')}</p>
          <p className="font-display text-5xl font-bold text-mint">{number(locale, Number(evaluation.overall_score))}</p>
          <h3 className="mt-5 font-semibold">{t('skills')}</h3>
          <ul className="mt-2 space-y-1 text-deep-muted">
            {evaluation.skill_scores.map((s) => <li key={s.skills.name_en}>{pick(locale, s.skills.name_ar, s.skills.name_en)}: L{s.level}</li>)}
          </ul>
          {evaluation.evaluation_reviews.length > 0 && (
            <>
              <h3 className="mt-5 font-semibold">{t('previousNotes')}</h3>
              <ul className="mt-1 text-deep-muted">{evaluation.evaluation_reviews.map((r) => <li key={r.id}>{r.notes}</li>)}</ul>
            </>
          )}
          <div className="mt-6">
            {evaluation.released_to_candidate ? (
              <p role="status" className="font-semibold text-mint">{t('released')}</p>
            ) : (
              <>
                <button type="button" onClick={release.fire} disabled={release.pending} aria-busy={release.pending} className="rounded-full bg-mint px-5 py-3 font-semibold text-forest disabled:opacity-60">{t('release')}</button>
                <ErrorText code={release.error} />
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
