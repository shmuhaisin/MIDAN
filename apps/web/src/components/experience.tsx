'use client';

import { CandidateMaterials, type CandidatePackage } from './assessment-intel';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { saveAnswer, startAttempt, submitAttempt, uploadEvidence } from '@/lib/actions';
import { formatWhen, list, number, pick, readableOnWhite } from '@/lib/format';
import { resolveHumaidan } from '@/lib/humaidan';
import { Arrow, Humaidan } from './brand';
import { ErrorText, PRIMARY, useAction } from './forms';

type Question = { id: string; prompt_ar: string; prompt_en: string; options: { id: string; label_ar: string; label_en: string }[] };
type Task = {
  id: string; position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string;
  task_skill_mappings?: { skills: { id: string; name_ar: string; name_en: string } }[];
  config: { questions?: Question[]; dataset_csv?: string; dataset_name?: string; deliverables_ar?: string[]; deliverables_en?: string[]; accepted_formats?: string[]; materials?: { title: string; url: string }[] };
};
type Answer = { text?: string; choices?: Record<string, string> };
export type ExperienceData = {
  mode: 'attempt' | 'preview';
  organization: { name_ar: string; name_en: string };
  branding: { primary_color: string | null; industry: string | null; welcome_ar: string | null; welcome_en: string | null } | null;
  job: { title_ar: string; title_en: string };
  version: {
    id: string; assessments: { title_ar: string; title_en: string; professional_field: string | null };
    scenario_ar: string | null; scenario_en: string | null; is_timed: boolean; deadline_hours: number | null;
    candidate_package?: CandidatePackage;
    candidate_rubric: { title_ar: string; title_en: string; criteria: { code: string; description_ar: string; description_en: string; max_score: string }[] }[] | null; duration_minutes: number | null; instructions_ar: string | null; instructions_en: string | null; assessment_tasks: Task[] };
  attempt: {
    id: string; status: string; started_at: string | null; deadline_at: string | null; expires_at: string | null; submitted_at: string | null; receipt_code: string | null;
    task_responses: { task_id: string; answer: Answer }[];
    evidence_files: { id: string; task_id: string; file_name: string }[];
  } | null;
};

function CsvTable({ csv }: { csv: string }) {
  const rows = useMemo(() => csv.trim().split('\n').map((line) => line.split(',')), [csv]);
  return (
    <div className="overflow-x-auto rounded-lg border border-border" dir="ltr">
      <table className="w-full text-start text-sm">
        <thead className="bg-surface-2"><tr>{rows[0].map((c) => <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">{c}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-3 py-1.5">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function isAnswered(task: Task, answer?: Answer) {
  if (task.task_type === 'objective_questions') {
    return (task.config.questions ?? []).every((q) => answer?.choices?.[q.id]);
  }
  return Boolean(answer?.text?.trim());
}

const subscribeNoop = () => () => {};

/** Counts down from what the server stored, so refreshing the page can't add time. */
function Remaining({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('experience');
  const locale = useLocale();
  const [, tick] = useState(0);
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return null;
  const left = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return <span role="timer" className={clsx('text-sm font-semibold', left < 5 * 60_000 && 'text-error')}>{t('remaining', { time: `${number(locale, minutes)}:${String(seconds).padStart(2, '0')}` })}</span>;
}

function Elapsed({ startedAt }: { startedAt: string }) {
  const t = useTranslations('experience');
  const locale = useLocale();
  const [, tick] = useState(0);
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
  return <span className="text-sm text-muted">{t('elapsed', { minutes: number(locale, minutes) })}</span>;
}

export function Experience({ data, logoUrl }: { data: ExperienceData; logoUrl: string | null }) {
  const t = useTranslations('experience');
  const tf = useTranslations('fields');
  const locale = useLocale();
  const router = useRouter();
  const tasks = data.version.assessment_tasks;
  const targetSkills = [...new Map(tasks.flatMap((task) => (task.task_skill_mappings ?? []).map((m) => [m.skills.id, m.skills] as const))).values()];
  const preview = data.mode === 'preview';
  const attempt = data.attempt;
  const [view, setView] = useState<'intro' | number | 'review' | 'done' | 'expired'>(() => {
    if (attempt?.status === 'submitted') return 'done';
    if (attempt?.status === 'expired') return 'expired';
    return attempt?.status === 'in_progress' ? 0 : 'intro';
  });
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => Object.fromEntries((attempt?.task_responses ?? []).map((r) => [r.task_id, r.answer])));
  const [files, setFiles] = useState(attempt?.evidence_files ?? []);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; answer: Answer }>());
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string>();
  const orgName = pick(locale, data.organization.name_ar, data.organization.name_en);
  // One saved answer for this whole assessment, so he never changes during navigation.
  const field = data.version.assessments.professional_field ?? data.branding?.industry ?? null;
  const variant = resolveHumaidan(data.version.assessments.professional_field, data.branding?.industry);
  const brand = data.branding?.primary_color;
  const welcome = pick(locale, data.branding?.welcome_ar ?? '', data.branding?.welcome_en ?? '');

  const begin = useAction(async () => {
    const result = await startAttempt((attempt as NonNullable<typeof attempt>).id);
    if (result.ok) {
      setView(0);
      router.refresh();
    }
    return result;
  });
  const submit = useAction(async () => {
    await flushSaves();
    const result = await submitAttempt((attempt as NonNullable<typeof attempt>).id);
    if (result.ok) {
      setView('done');
      router.refresh();
    } else if (result.error === 'not_allowed') {
      setView('expired');
    }
    return result;
  });

  async function persist(taskId: string, answer: Answer) {
    pending.current.delete(taskId);
    const result = await saveAnswer((attempt as NonNullable<typeof attempt>).id, taskId, answer);
    setSave(result.ok ? 'saved' : 'failed');
  }

  /** Each task saves on its own timer, so moving between tasks never drops an edit. */
  function update(task: Task, answer: Answer) {
    setAnswers((all) => ({ ...all, [task.id]: answer }));
    if (preview || !attempt) return;
    setSave('saving');
    clearTimeout(pending.current.get(task.id)?.timer);
    pending.current.set(task.id, { answer, timer: setTimeout(() => persist(task.id, answer), 700) });
  }

  function flushSaves() {
    return Promise.all(
      [...pending.current.entries()].map(([taskId, { timer, answer }]) => {
        clearTimeout(timer);
        return persist(taskId, answer);
      }),
    );
  }


  const header = (
    <header className="border-b-4 bg-surface" style={{ borderColor: brand ?? 'var(--primary)' }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl && <img src={logoUrl} alt="" className="h-11 w-auto max-w-32 rounded object-contain" />}
          <div>
            <p className="subsection-title">{orgName}</p>
            <p className="text-sm text-muted">
              {pick(locale, data.job.title_ar, data.job.title_en)}
              {pick(locale, data.version.assessments.title_ar, data.version.assessments.title_en) !== pick(locale, data.job.title_ar, data.job.title_en) && ` · ${pick(locale, data.version.assessments.title_ar, data.version.assessments.title_en)}`}
              {field && field !== 'general' && ` · ${t('fieldLabel', { field: tf(field) })}`}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">{t('poweredBy')}</p>
      </div>
    </header>
  );
  const banner = preview && <p role="status" className="bg-accent px-4 py-2 text-center text-sm font-semibold text-accent-foreground">{t('preview')}</p>;

  if (view === 'done') {
    return (
      <>
        {header}
        <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-24"><Humaidan outfit={variant} sizes="96px" /></motion.div>
          <h1 className="mt-6 page-title">{t('doneTitle')}</h1>
          <p className="mt-3 text-muted">{t('doneBody', { org: orgName })}</p>
          {attempt?.receipt_code && attempt.submitted_at && (
            <p role="status" className="mt-4 rounded-lg bg-surface p-4 text-sm">{t('receipt', { code: attempt.receipt_code, date: formatWhen(locale, attempt.submitted_at, 'Asia/Riyadh') })}</p>
          )}
          <Link href="/dashboard" className={clsx(PRIMARY, 'mt-6')}>{t('toDashboard')}<Arrow /></Link>
        </section>
      </>
    );
  }

  if (view === 'expired') {
    return (
      <>
        {header}
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h1 className="page-title">{t('expiredTitle')}</h1>
          <p className="mt-2 text-muted">{t('expiredBody')}</p>
          <Link href="/dashboard" className="mt-6 inline-block font-semibold text-primary underline underline-offset-4">{t('backToDashboard')}</Link>
        </section>
      </>
    );
  }

  if (view === 'intro') {
    const bandColor = brand && readableOnWhite(brand) ? brand : 'var(--deep)';
    return (
      <>
        {header}{banner}
        <section className="on-deep text-white" style={{ background: bandColor }}>
          <div className="mx-auto grid max-w-5xl items-end gap-4 px-4 pt-6 sm:px-6 sm:grid-cols-[1fr_auto]">
            <div className="pb-6">
              <h1 className="page-title">{t('introTitle', { job: pick(locale, data.job.title_ar, data.job.title_en) })}</h1>
              {welcome && <p className="mt-3 leading-relaxed opacity-90">{welcome}</p>}
            </div>
            <div className="mx-auto w-20 sm:w-24"><Humaidan outfit={variant} sizes="96px" priority idle /></div>
          </div>
        </section>
        <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          {pick(locale, data.version.scenario_ar ?? '', data.version.scenario_en ?? '') && (
            <div className="mb-6 rounded-lg bg-surface p-4">
              <h2 className="subsection-title">{t('scenario')}</h2>
              <p className="mt-1 leading-relaxed whitespace-pre-line">{pick(locale, data.version.scenario_ar ?? '', data.version.scenario_en ?? '')}</p>
            </div>
          )}
          <CandidateMaterials pkg={data.version.candidate_package ?? null} />
          <p className="leading-relaxed text-muted">{pick(locale, data.version.instructions_ar ?? '', data.version.instructions_en ?? '')}</p>
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-1 font-medium">
            {data.version.duration_minutes && <li>{t(data.version.is_timed ? 'timedFor' : 'estimated', { minutes: number(locale, data.version.duration_minutes) })}</li>}
            <li>{t('tasksCount', { count: number(locale, tasks.length) })}</li>
            {attempt?.deadline_at && <li>{t('deadlineOn', { date: formatWhen(locale, attempt.deadline_at, 'Asia/Riyadh') })}</li>}
          </ul>
          {data.version.is_timed && <p className="mt-2 text-sm text-muted">{t('timedNote')}</p>}
          {targetSkills.length > 0 && (
            <p className="mt-4"><span className="font-semibold">{t('targetSkills')}: </span>{targetSkills.map((s) => pick(locale, s.name_ar, s.name_en)).join(locale === 'ar' ? '، ' : ', ')}</p>
          )}
          {data.version.candidate_rubric && data.version.candidate_rubric.length > 0 && (
            <details className="mt-5 rounded-lg bg-surface p-4">
              <summary className="cursor-pointer font-semibold">{t('rubricTitle')}</summary>
              {data.version.candidate_rubric.map((task) => (
                <div key={task.title_en} className="mt-3">
                  <p className="font-medium">{pick(locale, task.title_ar, task.title_en)}</p>
                  <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-muted">
                    {task.criteria.map((c) => <li key={c.code}>{pick(locale, c.description_ar, c.description_en)} ({t('maxScore', { score: number(locale, Number(c.max_score)) })})</li>)}
                  </ul>
                </div>
              ))}
            </details>
          )}
          <h2 className="mt-7 subsection-title">{t('rulesTitle')}</h2>
          <ul className="mt-2 space-y-1.5 text-muted">{(t.raw('rules') as string[]).map((r) => <li key={r}>{r}</li>)}</ul>
          <div className="mt-7">
            {preview ? (
              <button type="button" onClick={() => setView(0)} className={PRIMARY}>{t('start')}<Arrow /></button>
            ) : (
              <button type="button" onClick={begin.fire} disabled={begin.pending} aria-busy={begin.pending} className={PRIMARY}>{t('start')}<Arrow /></button>
            )}
            <div className="mt-2"><ErrorText code={begin.error} /></div>
          </div>
        </section>
      </>
    );
  }

  const nav = (
    <nav aria-label={t('tasks')} className="flex gap-2 overflow-x-auto pb-1">
      {tasks.map((task, i) => (
        <button
          key={task.id}
          type="button"
          aria-current={view === i ? 'step' : undefined}
          onClick={() => setView(i)}
          className={clsx(
            'grid size-10 shrink-0 place-items-center rounded-full font-semibold transition-colors',
            view === i ? 'bg-primary text-primary-foreground' : isAnswered(task, answers[task.id]) ? 'bg-accent text-accent-foreground' : 'bg-surface-2 text-muted',
          )}
        >
          {number(locale, i + 1)}
        </button>
      ))}
      <button type="button" aria-current={view === 'review' ? 'step' : undefined} onClick={() => setView('review')} className={clsx('h-10 shrink-0 rounded-full px-4 text-sm font-semibold', view === 'review' ? 'bg-primary text-primary-foreground' : 'bg-surface-2')}>
        {t('review')}
      </button>
    </nav>
  );

  if (view === 'review') {
    const answered = tasks.filter((task) => isAnswered(task, answers[task.id])).length;
    const missing = tasks.filter((task) => !isAnswered(task, answers[task.id]));
    return (
      <>
        {header}{banner}
        <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          {nav}
          <h1 className="mt-8 page-title">{t('reviewTitle')}</h1>
          <p className="mt-3 text-lg">{t('answered', { answered: number(locale, answered), total: number(locale, tasks.length) })}</p>
          {missing.length > 0 && (
            <p className="mt-1 text-muted">{t('unanswered', { tasks: list(locale, missing.map((m) => pick(locale, m.title_ar, m.title_en))) })}</p>
          )}
          <p className="mt-5 border-s-2 border-gold ps-4 font-medium">{t('submitNote')}</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            {!preview && <button type="button" onClick={submit.fire} disabled={submit.pending} aria-busy={submit.pending} className={PRIMARY}>{t('submit')}</button>}
            <button type="button" onClick={() => setView(0)} className="font-semibold">{t('back')}</button>
          </div>
          <div className="mt-3"><ErrorText code={submit.error} /></div>
        </section>
      </>
    );
  }

  const index = view as number;
  const task = tasks[index];
  const answer = answers[task.id] ?? {};
  const taskFiles = files.filter((f) => f.task_id === task.id);

  function upload(file: File | undefined) {
    if (!file || !attempt) return;
    if (file.size > 25 * 1024 * 1024) return setUploadError('too_large');
    const form = new FormData();
    form.append('file', file);
    setUploadError(undefined);
    startUpload(async () => {
      const result = await uploadEvidence(attempt.id, task.id, form);
      if (result.file) setFiles((all) => [...all, { ...(result.file as { id: string; file_name: string }), task_id: task.id }]);
      setUploadError(result.error);
    });
  }

  return (
    <>
      {header}{banner}
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {nav}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted">{t('taskOf', { current: number(locale, index + 1), total: number(locale, tasks.length) })}</p>
          <div className="flex items-center gap-4">
            {attempt?.expires_at ? <Remaining expiresAt={attempt.expires_at} /> : attempt?.started_at && <Elapsed startedAt={attempt.started_at} />}
            <p aria-live="polite" className={clsx('min-w-16 text-sm font-medium', save === 'failed' ? 'text-error' : 'text-primary')}>
              {save === 'saving' ? t('saving') : save === 'saved' ? t('saved') : save === 'failed' ? t('saveFailed') : ''}
            </p>
          </div>
        </div>
        <h1 className="mt-2 section-title">{pick(locale, task.title_ar, task.title_en)}</h1>
        <p className="mt-3 leading-relaxed whitespace-pre-line">{pick(locale, task.instructions_ar, task.instructions_en)}</p>

        {(task.config.deliverables_en?.length || task.config.deliverables_ar?.length || task.config.materials?.length || task.config.accepted_formats?.length) ? (
          <div className="mt-4 space-y-2 rounded-lg bg-surface p-4 text-sm">
            {(locale === 'ar' ? task.config.deliverables_ar : task.config.deliverables_en)?.length ? (
              <div><p className="font-semibold">{t('deliverables')}</p><ul className="mt-1 list-disc ps-5">{(locale === 'ar' ? task.config.deliverables_ar : task.config.deliverables_en)?.map((d) => <li key={d}>{d}</li>)}</ul></div>
            ) : null}
            {task.config.materials?.length ? (
              <div><p className="font-semibold">{t('materials')}</p><ul className="mt-1 space-y-1">{task.config.materials.filter((m) => m.url.startsWith('https://')).map((m) => <li key={m.url}><a href={m.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{m.title}</a></li>)}</ul></div>
            ) : null}
            {task.config.accepted_formats?.length ? <p><span className="font-semibold">{t('acceptedFormats')}: </span><bdi>{task.config.accepted_formats.join(', ')}</bdi></p> : null}
          </div>
        ) : null}
        {task.config.dataset_csv && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="font-semibold">{t('dataset')}</h2>
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(task.config.dataset_csv)}`} download={task.config.dataset_name} className="text-sm font-semibold text-primary underline underline-offset-4">{t('download')}</a>
            </div>
            <CsvTable csv={task.config.dataset_csv} />
          </div>
        )}

        {task.task_type === 'objective_questions' ? (
          <div className="mt-6 space-y-6">
            {(task.config.questions ?? []).map((q, qi) => (
              <fieldset key={q.id}>
                <legend className="font-semibold">{number(locale, qi + 1)}. {pick(locale, q.prompt_ar, q.prompt_en)}</legend>
                <div className="mt-2 space-y-2">
                  {q.options.map((o) => (
                    <label key={o.id} className={clsx('flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors', answer.choices?.[q.id] === o.id ? 'border-primary bg-surface' : 'border-border')}>
                      <input
                        type="radio" name={q.id} value={o.id} checked={answer.choices?.[q.id] === o.id}
                        onChange={() => update(task, { choices: { ...answer.choices, [q.id]: o.id } })}
                        className="size-4 accent-[var(--primary)]"
                      />
                      {pick(locale, o.label_ar, o.label_en)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        ) : (
          <div className="mt-6">
            <label className="block">
              <span className="font-semibold">{t('yourAnswer')}</span>
              <textarea
                rows={10} value={answer.text ?? ''} placeholder={t('placeholder')}
                onChange={(e) => update(task, { text: e.target.value })}
                className="mt-2 block w-full rounded-lg border border-border bg-surface p-3.5 leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </label>
            {!preview && (
              <div className="mt-4">
                <label className={clsx('inline-flex cursor-pointer items-center gap-2 rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-primary', uploading && 'opacity-60')}>
                  <input type="file" className="sr-only" disabled={uploading} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                  {uploading ? t('uploading') : t('upload')}
                </label>
                <p className="mt-1 text-xs text-muted">{t('uploadHint')}</p>
                <div className="mt-2"><ErrorText code={uploadError} /></div>
                {taskFiles.length > 0 && (
                  <div className="mt-2 text-sm">
                    <p className="font-medium">{t('uploaded')}</p>
                    <ul className="text-muted" dir="ltr">{taskFiles.map((f) => <li key={f.id}>{f.file_name}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button type="button" disabled={index === 0} onClick={() => setView(index - 1)} className="font-semibold disabled:invisible">{t('previous')}</button>
          <button type="button" onClick={() => setView(index + 1 < tasks.length ? index + 1 : 'review')} className={PRIMARY}>
            {index + 1 < tasks.length ? t('next') : t('review')}<Arrow />
          </button>
        </div>
      </section>
    </>
  );
}
