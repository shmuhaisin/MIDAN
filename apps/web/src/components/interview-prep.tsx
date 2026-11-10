'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { prepareInterview } from '@/lib/candidate-actions';
import { formatDate } from '@/lib/format';
import { ErrorText } from './forms';

import type { Fact, Preparation, Version } from '@/lib/interview-prep';

export type { Preparation } from '@/lib/interview-prep';

/**
 * Interview preparation for one candidate, for the organization's staff only: the questions MIDAN proposes and the
 * evaluation form for afterwards, each citing the facts it rests on. Proposals for people to use and change; the candidate
 * never sees them.
 */
export function InterviewPreparation({ orgId, interviewId, prep, canPrepare }: { orgId: string; interviewId: string; prep: Preparation | null; canPrepare: boolean }) {
  const t = useTranslations('interviewPrep');
  const locale = useLocale();
  const ar = locale === 'ar';
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string | null>(null);
  const run = (kind: 'questions' | 'evaluation_form') => start(async () => setError((await prepareInterview(orgId, interviewId, kind)).error));
  const facts = (version: Version<unknown>, ids: string[]) => ids.map((id) => version?.facts.find((f) => f.id === id)).filter(Boolean) as Fact[];
  const basis = (key: string, version: Version<unknown>, ids: string[]) => (
    <>
      <button type="button" className="mt-1 text-xs font-semibold underline underline-offset-4" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{t('basis')}</button>
      {open === key && <ul className="mt-1 list-disc ps-5 text-xs text-muted">{facts(version, ids).map((f) => <li key={f.id}><bdi>{f.text}</bdi></li>)}</ul>}
    </>
  );
  const made = (v: Version<unknown>) => v && <p className="text-xs text-muted">{t('proposed', { date: formatDate(locale, v.created_at, 'Asia/Riyadh') })}</p>;
  return (
    <div className="mt-4 space-y-6 rounded-[var(--radius-panel)] border border-border bg-background p-4">
      <p className="text-sm text-muted">{t('note')}</p>
      <ErrorText code={error} />
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t('questionsTitle')}</h3>
          {canPrepare && <button type="button" disabled={pending} aria-busy={pending} onClick={() => run('questions')} className="btn btn-secondary btn-sm">{prep?.questions ? t('regenerate') : t('prepareQuestions')}</button>}
        </div>
        {made(prep?.questions ?? null)}
        {!prep?.questions ? <p className="mt-2 text-sm text-muted">{t('noQuestions')}</p> : (
          <ol className="mt-2 list-decimal space-y-3 ps-5 text-sm">
            {prep.questions.content.map((q, i) => (
              <li key={i}>
                <p className="font-medium">{ar ? q.question_ar : q.question_en}</p>
                <p className="text-xs text-muted">{t(`purpose.${q.purpose}`)} · {t('listenFor')}: {ar ? q.listen_for_ar : q.listen_for_en}</p>
                {basis(`q${i}`, prep.questions, q.fact_ids)}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t('formTitle')}</h3>
          {canPrepare && <button type="button" disabled={pending} aria-busy={pending} onClick={() => run('evaluation_form')} className="btn btn-secondary btn-sm">{prep?.evaluation_form ? t('regenerate') : t('prepareForm')}</button>}
        </div>
        {made(prep?.evaluation_form ?? null)}
        {!prep?.evaluation_form ? <p className="mt-2 text-sm text-muted">{t('noForm')}</p> : (
          <ul className="mt-2 space-y-3 text-sm">
            {prep.evaluation_form.content.map((c, i) => (
              <li key={i}>
                <p className="font-medium">{ar ? c.label_ar : c.label_en}</p>
                <p className="text-xs">{ar ? c.criteria_ar : c.criteria_en}</p>
                <dl className="mt-1 grid gap-x-3 text-xs text-muted sm:grid-cols-[auto_1fr]">
                  {['1', '2', '3', '4'].map((n) => <div key={n} className="contents"><dt className="font-semibold">{n}</dt><dd>{(ar ? c.levels_ar : c.levels_en)[n]}</dd></div>)}
                </dl>
                {basis(`c${i}`, prep.evaluation_form, c.fact_ids)}
              </li>
            ))}
          </ul>
        )}
        {prep?.evaluation_form && <p className="mt-2 text-xs text-muted">{t('formUsed')}</p>}
      </section>
    </div>
  );
}
