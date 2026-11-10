'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';
import { answerReadiness, startReadiness } from '@/lib/readiness-actions';
import { ErrorText } from './forms';

type Requirement = { key: string; name_ar: string; name_en: string; category: string; importance: 'core' | 'important' | 'helpful'; proficiency: string; why_ar: string; why_en: string };
type Question = { id: string; kind: string; requirement_keys: string[]; prompt_ar: string; prompt_en: string; rubric_ar: string; rubric_en: string; minutes: number };
type Match = { key: string; status: 'matched' | 'partial' | 'missing' | 'needs_review'; evidence_text: string | null; evidence_source: string | null };
type QuestionResult = { question_id: string; score: number; quote: string; strengths_ar: string; strengths_en: string; improve_ar: string; improve_en: string };
type Step = { title_ar: string; title_en: string; why_ar: string; why_en: string; requirement_keys: string[]; actions_ar: string[]; actions_en: string[]; weeks: number; resource_ids: string[] };
type Recommendation = { resource_id: string; requirement_keys: string[]; reason_ar: string; reason_en: string };
type Evaluation = {
  questions: QuestionResult[]; readiness: 'ready' | 'nearly_ready' | 'developing' | 'early'; readiness_ar: string; readiness_en: string;
  strengths_ar: string[]; strengths_en: string[]; gaps_ar: string[]; gaps_en: string[]; roadmap: Step[]; recommendations: Recommendation[];
  provenance: { model_version?: string };
};
type Resource = { id: string; kind: 'course' | 'certification'; title_ar: string | null; title_en: string | null; provider: string; url: string; verified_on: string;
  skills_en: string[]; skills_ar: string[]; level: string | null; duration: string | null; cost: string | null; prerequisites: string | null };
export type Readiness = {
  id: string; target_title: string; status: 'assessment' | 'evaluated'; created_at: string;
  plan: { title_ar: string; title_en: string; summary_ar: string; summary_en: string; requirements: Requirement[]; questions: Question[]; provenance: { model_version?: string } };
  comparison: { matches: Match[]; provenance?: { provider?: string; model_version?: string } };
  answers: { question_id: string; text: string }[] | null; evaluation: Evaluation | null; resources?: Resource[];
};

const MATCH_TONE: Record<Match['status'], string> = {
  matched: 'border-primary/40 bg-success-surface text-primary',
  partial: 'border-gold/50 bg-warning-surface text-warning',
  missing: 'border-dashed border-border-strong text-muted',
  needs_review: 'border-info/40 bg-info-surface text-info',
};

function Unavailable({ error, reason }: { error?: string; reason?: string }) {
  const t = useTranslations('readiness');
  if (!error) return null;
  if (error === 'unavailable' && reason) return <p role="alert" className="callout text-sm">{t(`unavailable.${['quota_exhausted', 'rate_limited', 'not_configured'].includes(reason) ? reason : 'other'}`)}</p>;
  return <ErrorText code={error} />;
}

/** The target title form: the job the candidate wants, in their own words. */
export function ReadinessStart({ initial }: { initial?: string }) {
  const t = useTranslations('readiness');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const [title, setTitle] = useState(initial ?? '');
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; reason?: string }>({});
  const submit = () => start(async () => {
    const out = await startReadiness(title, locale);
    setResult(out);
    if (out.id) router.push(`/development/readiness?id=${out.id}`);
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!pending && title.trim().length >= 2) submit(); }}>
      <label className="block">
        <span className="field-label">{t('start.label')}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} minLength={2} required dir="auto"
          placeholder={t('start.placeholder')} className="input" />
      </label>
      <p className="text-xs text-muted">{t('start.hint')}</p>
      <button type="submit" disabled={pending || title.trim().length < 2} aria-busy={pending} className="btn btn-primary">
        {pending ? t('start.working') : t('start.action')}
      </button>
      <Unavailable error={result.error} reason={result.reason} />
    </form>
  );
}

export function ReadinessView({ data }: { data: Readiness }) {
  const t = useTranslations('readiness');
  const locale = useLocale();
  const say = (ar: string, en: string) => pick(locale, ar || en, en || ar);
  const matches = new Map(data.comparison.matches.map((m) => [m.key, m]));
  const names = new Map(data.plan.requirements.map((r) => [r.key, say(r.name_ar, r.name_en)]));
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="label-caps">{t('eyebrow')}</p>
        <h1 className="display-lg mt-2 text-balance" dir="auto">{say(data.plan.title_ar, data.plan.title_en)}</h1>
        <p className="mt-1 text-sm text-muted" dir="auto">{t('typed', { title: data.target_title })}</p>
        <p className="mt-3 leading-relaxed text-muted" dir="auto">{say(data.plan.summary_ar, data.plan.summary_en)}</p>
      </header>

      <section aria-labelledby="requirements" className="rounded-[var(--radius-panel)] border border-border bg-surface">
        <div className="border-b border-border px-6 py-5 lg:px-8">
          <h2 id="requirements" className="font-display text-xl font-bold">{t('requirements.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('requirements.lead')}</p>
        </div>
        <ol className="divide-y divide-border">
          {data.plan.requirements.map((r) => {
            const m = matches.get(r.key);
            return (
              <li key={r.key} className="grid gap-2 px-6 py-4 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-6 lg:px-8">
                <div className="flex flex-wrap gap-2 lg:flex-col lg:items-start">
                  {m && <span className={clsx('chip text-xs font-semibold', MATCH_TONE[m.status])}>{t(`match.${m.status}`)}</span>}
                  <span className="text-xs text-muted">{t(`importance.${r.importance}`)} · {t(`category.${r.category}`)}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold" dir="auto">{say(r.name_ar, r.name_en)}</p>
                  <p className="mt-1 text-sm text-muted" dir="auto">{say(r.why_ar, r.why_en)}</p>
                  {m?.evidence_text && <p className="mt-2 border-s-2 border-gold ps-3 text-sm" dir="auto"><span className="text-xs font-semibold text-gold-text">{t('fromProfile')}: </span>{m.evidence_text}</p>}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="border-t border-border px-6 py-3 text-xs text-muted lg:px-8">
          {t('requirements.provenance', { model: data.plan.provenance.model_version ?? '', matcher: data.comparison.provenance?.model_version ?? data.comparison.provenance?.provider ?? '' })}
        </p>
      </section>

      {data.status === 'assessment' ? <Answer data={data} /> : data.evaluation && <Results data={data} names={names} />}
    </div>
  );
}

function Answer({ data }: { data: Readiness }) {
  const t = useTranslations('readiness');
  const locale = useLocale();
  const router = useRouter();
  const say = (ar: string, en: string) => pick(locale, ar || en, en || ar);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; reason?: string }>({});
  const total = data.plan.questions.reduce((sum, q) => sum + q.minutes, 0);
  const submit = () => start(async () => {
    const out = await answerReadiness(data.id, data.plan.questions.map((q) => ({ question_id: q.id, text: answers[q.id] ?? '' })));
    setResult(out);
    if (out.ok) router.refresh();
  });
  return (
    <section aria-labelledby="assessment" className="space-y-4">
      <div>
        <h2 id="assessment" className="section-title">{t('assessment.title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t('assessment.lead', { minutes: number(locale, total) })}</p>
      </div>
      <ol className="space-y-4">
        {data.plan.questions.map((q, i) => (
          <li key={q.id} className="rounded-[var(--radius-panel)] border border-border bg-surface p-5 lg:p-6">
            <p className="text-xs font-semibold text-muted"><span className="num">{number(locale, i + 1)}</span> · {t(`kind.${q.kind}`)} · <span className="num">{t('minutes', { n: number(locale, q.minutes) })}</span></p>
            <p className="mt-2 whitespace-pre-line leading-relaxed" dir="auto">{say(q.prompt_ar, q.prompt_en)}</p>
            <textarea value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} maxLength={6000} rows={6} dir="auto"
              aria-label={t('assessment.answerLabel', { n: number(locale, i + 1) })} className="input mt-3 min-h-32" />
          </li>
        ))}
      </ol>
      <button type="button" onClick={submit} disabled={pending || !Object.values(answers).some((a) => a.trim().length >= 20)} aria-busy={pending} className="btn btn-primary">
        {pending ? t('assessment.working') : t('assessment.submit')}
      </button>
      <Unavailable error={result.error} reason={result.reason} />
    </section>
  );
}

function Results({ data, names }: { data: Readiness; names: Map<string, string> }) {
  const t = useTranslations('readiness');
  const locale = useLocale();
  const ev = data.evaluation!;
  const say = (ar: string, en: string) => pick(locale, ar || en, en || ar);
  const list = (ar: string[], en: string[]) => (locale === 'ar' ? (ar.length ? ar : en) : (en.length ? en : ar));
  const resources = new Map((data.resources ?? []).map((r) => [r.id, r]));
  const answers = new Map((data.answers ?? []).map((a) => [a.question_id, a.text]));
  const earned = ev.questions.reduce((s, q) => s + q.score, 0);
  return (
    <div className="space-y-8">
      <section aria-labelledby="readiness" className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8">
        <p className="label-caps">{t('result.eyebrow')}</p>
        <h2 id="readiness" className="mt-2 font-display text-2xl font-bold">{t(`level.${ev.readiness}`)}</h2>
        <p className="mt-3 max-w-3xl leading-relaxed" dir="auto">{say(ev.readiness_ar, ev.readiness_en)}</p>
        <p className="mt-3 text-sm text-muted">{t('result.points', { earned: number(locale, earned), total: number(locale, ev.questions.length * 4) })}</p>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">{t('result.strengths')}</h3>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">{list(ev.strengths_ar, ev.strengths_en).map((s) => <li key={s} dir="auto">{s}</li>)}</ul>
          </div>
          <div>
            <h3 className="font-semibold">{t('result.gaps')}</h3>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">{list(ev.gaps_ar, ev.gaps_en).map((s) => <li key={s} dir="auto">{s}</li>)}</ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="answers" className="space-y-3">
        <h2 id="answers" className="section-title">{t('result.answers')}</h2>
        <ol className="space-y-3">
          {data.plan.questions.map((q, i) => {
            const r = ev.questions.find((x) => x.question_id === q.id);
            return (
              <li key={q.id} className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold"><span className="num">{number(locale, i + 1)}</span>. {q.requirement_keys.map((k) => names.get(k)).filter(Boolean).join('، ')}</span>
                  <span className="num font-display text-lg font-bold">{number(locale, r?.score ?? 0)} / {number(locale, 4)}</span>
                </p>
                {!answers.get(q.id) && <p className="mt-1 text-sm text-muted">{t('result.unanswered')}</p>}
                {r?.quote && <blockquote className="mt-2 border-s-2 border-gold ps-3 text-sm" dir="auto">{r.quote}</blockquote>}
                {r && (r.strengths_ar || r.strengths_en) && <p className="mt-2 text-sm" dir="auto"><span className="font-semibold">{t('result.good')}: </span>{say(r.strengths_ar, r.strengths_en)}</p>}
                {r && <p className="mt-1 text-sm" dir="auto"><span className="font-semibold">{t('result.improve')}: </span>{say(r.improve_ar, r.improve_en)}</p>}
                <details className="mt-2 text-sm text-muted"><summary className="cursor-pointer">{t('result.rubric')}</summary><p className="mt-1" dir="auto">{say(q.rubric_ar, q.rubric_en)}</p></details>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="roadmap" className="space-y-3">
        <h2 id="roadmap" className="section-title">{t('result.roadmap')}</h2>
        <ol className="space-y-3">
          {ev.roadmap.map((s, i) => (
            <li key={i} className="grid gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-5 md:grid-cols-[3rem_minmax(0,1fr)]">
              <span aria-hidden className="num font-display text-2xl font-bold text-gold-text">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold" dir="auto">{say(s.title_ar, s.title_en)}</span>
                  <span className="num text-xs text-muted">{t('weeks', { n: number(locale, s.weeks) })}</span>
                </p>
                <p className="mt-1 text-sm text-muted" dir="auto">{say(s.why_ar, s.why_en)}</p>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">{(locale === 'ar' ? s.actions_ar : s.actions_en).map((a) => <li key={a} dir="auto">{a}</li>)}</ul>
                {s.resource_ids.filter((id) => resources.has(id)).length > 0 && (
                  <p className="mt-2 text-sm">{t('result.with')}: {s.resource_ids.map((id) => resources.get(id)).filter(Boolean).map((r) => say(r!.title_ar ?? '', r!.title_en ?? '')).join('، ')}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="learning" className="space-y-3">
        <h2 id="learning" className="section-title">{t('result.learning')}</h2>
        {ev.recommendations.length === 0 ? (
          <p className="callout text-sm">{t('result.noCatalog')}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {ev.recommendations.map((rec) => {
              const r = resources.get(rec.resource_id);
              if (!r) return null;
              return (
                <li key={rec.resource_id} className="flex flex-col rounded-[var(--radius-panel)] border border-border bg-surface p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t(`resource.${r.kind}`)}{r.level ? ` · ${t(`resource.level.${r.level}`)}` : ''}</p>
                  <p className="mt-1 font-semibold" dir="auto">{say(r.title_ar ?? '', r.title_en ?? '')}</p>
                  <p className="text-sm text-muted">{r.provider}</p>
                  <p className="mt-2 text-sm" dir="auto">{say(rec.reason_ar, rec.reason_en)}</p>
                  {(locale === 'ar' ? r.skills_ar : r.skills_en).length > 0 && <p className="mt-2 text-xs text-muted" dir="auto">{t('resource.skills')}: {(locale === 'ar' ? r.skills_ar : r.skills_en).join('، ')}</p>}
                  {r.prerequisites && <p className="mt-1 text-xs text-muted">{t('resource.prerequisites')}: {r.prerequisites}</p>}
                  <p className="mt-1 text-xs text-muted">{r.duration || r.cost ? [r.duration, r.cost].filter(Boolean).join(' · ') : t('resource.seeOfficial')}</p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">{t('resource.open')}</a>
                    <span className="num text-xs text-muted">{t('resource.verified', { date: r.verified_on.slice(0, 10) })}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">{t('result.provenance', { model: ev.provenance.model_version ?? '' })}</p>
      </section>
    </div>
  );
}
