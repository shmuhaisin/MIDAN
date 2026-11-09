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
import { Icon } from './icons';
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


  const assessmentTitle = pick(locale, data.version.assessments.title_ar, data.version.assessments.title_en);
  const jobTitle = pick(locale, data.job.title_ar, data.job.title_en);
  const header = (
    <header className="border-b border-border bg-surface">
      <div aria-hidden className="h-1" style={{ background: brand ?? 'var(--brand-deep)' }} />
      <div className="container-page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
        <div className="flex min-w-0 items-center gap-4">
          {logoUrl
            ? <img src={logoUrl} alt="" className="h-11 w-auto max-w-32 shrink-0 rounded-[var(--radius-control)] object-contain" />
            : <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] font-display text-lg font-bold text-ivory" style={{ background: brand ?? 'var(--brand-deep)' }}>{orgName.trim().charAt(0)}</span>}
          <div className="min-w-0">
            <p className="truncate font-display font-bold">{orgName}</p>
            <p className="truncate text-sm text-muted">
              {jobTitle}
              {assessmentTitle !== jobTitle && ` · ${assessmentTitle}`}
              {field && field !== 'general' && ` · ${t('fieldLabel', { field: tf(field) })}`}
            </p>
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted"><span aria-hidden className="size-1.5 rotate-45 bg-gold" />{t('poweredBy')}</p>
      </div>
    </header>
  );
  const banner = preview && <p role="status" className="bg-accent px-4 py-2 text-center text-sm font-semibold text-accent-foreground">{t('preview')}</p>;

  if (view === 'done') {
    return (
      <>
        {header}
        <section className="container-page flex min-h-[70svh] items-center py-14">
          <div className="mx-auto grid w-full max-w-3xl items-center gap-10 md:grid-cols-[12rem_minmax(0,1fr)]">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} aria-hidden className="relative mx-auto w-36 md:w-full">
              <div className="najdi-arch aspect-[5/6] bg-deep"><span className="absolute inset-x-[8%] bottom-0 h-1 bg-mint" /></div>
              <div className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"><Humaidan outfit={variant} sizes="190px" /></div>
            </motion.div>
            <div className="text-center md:text-start">
              <p className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-success-surface px-2.5 py-1 text-sm font-semibold text-success"><Icon name="check" className="size-4" />{t('submittedBadge')}</p>
              <h1 className="display-lg mt-4">{t('doneTitle')}</h1>
              <p className="mt-3 text-lg leading-relaxed text-muted">{t('doneBody', { org: orgName })}</p>
              {attempt?.receipt_code && attempt.submitted_at && (
                <p role="status" className="callout mt-6 text-sm">{t('receipt', { code: attempt.receipt_code, date: formatWhen(locale, attempt.submitted_at, 'Asia/Riyadh') })}</p>
              )}
              <Link href="/dashboard" className={clsx(PRIMARY, 'btn-lg mt-8')}>{t('toDashboard')}<Arrow /></Link>
            </div>
          </div>
        </section>
      </>
    );
  }

  if (view === 'expired') {
    return (
      <>
        {header}
        <section className="container-page max-w-3xl py-14">
          <div className="callout">
            <h1 className="page-title">{t('expiredTitle')}</h1>
            <p className="mt-2 text-muted">{t('expiredBody')}</p>
            <Link href="/dashboard" className="btn btn-primary mt-6">{t('backToDashboard')}</Link>
          </div>
        </section>
      </>
    );
  }

  if (view === 'intro') {
    const bandColor = brand && readableOnWhite(brand) ? brand : 'var(--deep)';
    const scenario = pick(locale, data.version.scenario_ar ?? '', data.version.scenario_en ?? '');
    const facts = [
      data.version.duration_minutes ? t(data.version.is_timed ? 'timedFor' : 'estimated', { minutes: number(locale, data.version.duration_minutes) }) : null,
      t('tasksCount', { count: number(locale, tasks.length) }),
      attempt?.deadline_at ? t('deadlineOn', { date: formatWhen(locale, attempt.deadline_at, 'Asia/Riyadh') }) : null,
    ].filter(Boolean) as string[];
    return (
      <>
        {header}{banner}
        <section className="on-deep relative overflow-hidden text-white" style={{ background: bandColor }}>
          <div className="container-page relative grid items-end gap-6 pt-10 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="pb-10">
              <p className="label-caps text-white/75!">{assessmentTitle}</p>
              <h1 className="display-lg mt-3 max-w-3xl text-balance">{t('introTitle', { job: jobTitle })}</h1>
              {welcome && <p className="mt-4 max-w-2xl text-lg leading-relaxed opacity-90">{welcome}</p>}
            </div>
            <div className="mx-auto w-28 sm:w-36"><Humaidan outfit={variant} sizes="144px" priority idle /></div>
          </div>
        </section>
        <div className="container-page">
          <ul className="-mt-px grid gap-px overflow-hidden rounded-b-[var(--radius-panel)] border border-t-0 border-border bg-border sm:grid-cols-3">
            {facts.map((f) => <li key={f} className="bg-surface px-5 py-4 font-semibold">{f}</li>)}
          </ul>
        </div>
        <section className="container-page grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
          <div className="min-w-0 space-y-8">
            {scenario && (
              <div className="callout">
                <h2 className="label-caps">{t('scenario')}</h2>
                <p className="mt-2 text-lg leading-relaxed whitespace-pre-line">{scenario}</p>
              </div>
            )}
            <CandidateMaterials pkg={data.version.candidate_package ?? null} />
            <p className="text-lg leading-relaxed text-foreground/85">{pick(locale, data.version.instructions_ar ?? '', data.version.instructions_en ?? '')}</p>
            {data.version.is_timed && <p className="flex items-center gap-2 text-sm text-muted"><Icon name="clock" className="size-4" />{t('timedNote')}</p>}
            {data.version.candidate_rubric && data.version.candidate_rubric.length > 0 && (
              <details className="panel group">
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-semibold">{t('rubricTitle')}<Icon name="chevron" className="size-4 rotate-90 transition-transform group-open:-rotate-90" /></summary>
                <div className="border-t border-border px-5 pb-5">
                  {data.version.candidate_rubric.map((rt) => (
                    <div key={rt.title_en} className="mt-4">
                      <p className="font-medium">{pick(locale, rt.title_ar, rt.title_en)}</p>
                      <ul className="mt-2 space-y-1.5 text-sm text-muted">
                        {rt.criteria.map((c) => <li key={c.code} className="flex justify-between gap-4"><span>{pick(locale, c.description_ar, c.description_en)}</span><span className="num shrink-0">{t('maxScore', { score: number(locale, Number(c.max_score)) })}</span></li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            {targetSkills.length > 0 && (
              <div className="panel panel-body">
                <p className="subsection-title">{t('targetSkills')}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">{targetSkills.map((sk) => <li key={sk.id} className="rounded-[3px] bg-accent px-2 py-1 text-sm font-medium text-accent-foreground">{pick(locale, sk.name_ar, sk.name_en)}</li>)}</ul>
              </div>
            )}
            <div className="panel panel-body">
              <p className="subsection-title">{t('rulesTitle')}</p>
              <ol className="mt-3 space-y-2.5 text-sm">
                {(t.raw('rules') as string[]).map((r, i) => <li key={r} className="flex gap-3"><span className="num font-semibold text-gold-text">{number(locale, i + 1)}</span><span className="text-foreground/85">{r}</span></li>)}
              </ol>
              <div className="mt-6 border-t border-border pt-5">
                {preview ? (
                  <button type="button" onClick={() => setView(0)} className={clsx(PRIMARY, 'btn-lg btn-block')}>{t('start')}<Arrow /></button>
                ) : (
                  <button type="button" onClick={begin.fire} disabled={begin.pending} aria-busy={begin.pending} className={clsx(PRIMARY, 'btn-lg btn-block')}>{t('start')}<Arrow /></button>
                )}
                <div className="mt-2"><ErrorText code={begin.error} /></div>
              </div>
            </div>
          </aside>
        </section>
      </>
    );
  }

  const answeredCount = tasks.filter((tk) => isAnswered(tk, answers[tk.id])).length;
  const nav = (
    <nav aria-label={t('tasks')} className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {tasks.map((tk, i) => {
        const done = isAnswered(tk, answers[tk.id]);
        return (
          <button
            key={tk.id}
            type="button"
            aria-current={view === i ? 'step' : undefined}
            aria-label={`${number(locale, i + 1)}. ${pick(locale, tk.title_ar, tk.title_en)}`}
            onClick={() => setView(i)}
            className={clsx(
              'relative grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] border font-semibold transition-colors',
              view === i ? 'border-transparent bg-[var(--button)] text-[var(--button-foreground)]' : done ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border bg-surface text-muted hover:text-foreground',
            )}
          >
            {number(locale, i + 1)}
            {done && view !== i && <span aria-hidden className="absolute -top-1 -end-1 size-2 rotate-45 bg-gold" />}
          </button>
        );
      })}
      <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border-strong" />
      <button type="button" aria-current={view === 'review' ? 'step' : undefined} onClick={() => setView('review')} className={clsx('btn btn-sm shrink-0', view === 'review' ? 'btn-primary' : 'btn-secondary')}>
        {t('review')}
      </button>
    </nav>
  );

  if (view === 'review') {
    const missing = tasks.filter((tk) => !isAnswered(tk, answers[tk.id]));
    return (
      <>
        {header}{banner}
        <section className="container-page max-w-4xl py-8">
          {nav}
          <h1 className="display-lg mt-10">{t('reviewTitle')}</h1>
          <p className="mt-3 text-lg">{t('answered', { answered: number(locale, answeredCount), total: number(locale, tasks.length) })}</p>
          <ul className="mt-6 divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
            {tasks.map((tk, i) => {
              const done = isAnswered(tk, answers[tk.id]);
              return (
                <li key={tk.id}>
                  <button type="button" onClick={() => setView(i)} className="flex w-full items-center gap-4 px-5 py-4 text-start hover:bg-surface-2/60">
                    <span aria-hidden className={clsx('grid size-7 shrink-0 place-items-center rounded-full', done ? 'bg-primary text-primary-foreground' : 'border border-border-strong text-muted')}>
                      {done ? <Icon name="check" className="size-4" /> : <span className="num text-xs">{number(locale, i + 1)}</span>}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{pick(locale, tk.title_ar, tk.title_en)}</span>
                    <Icon name="chevron" className="size-4 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
          {missing.length > 0 && (
            <p className="mt-3 text-sm text-muted">{t('unanswered', { tasks: list(locale, missing.map((m) => pick(locale, m.title_ar, m.title_en))) })}</p>
          )}
          <p className="mt-6 callout font-medium">{t('submitNote')}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!preview && <button type="button" onClick={submit.fire} disabled={submit.pending} aria-busy={submit.pending} className={clsx(PRIMARY, 'btn-lg')}>{t('submit')}</button>}
            <button type="button" onClick={() => setView(0)} className="btn btn-ghost btn-lg">{t('back')}</button>
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

  const deliverables = locale === 'ar' ? task.config.deliverables_ar : task.config.deliverables_en;
  return (
    <>
      {header}{banner}
      <div className="sticky top-[4.5rem] z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3">
          {nav}
          <div className="flex items-center gap-3">
            {attempt?.expires_at ? <Remaining expiresAt={attempt.expires_at} /> : attempt?.started_at && <Elapsed startedAt={attempt.started_at} />}
            <p aria-live="polite" className={clsx('inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-semibold', save === 'failed' ? 'bg-error-surface text-error' : save === 'idle' ? '' : 'bg-success-surface text-success')}>
              {save === 'saving' ? t('saving') : save === 'saved' ? <><Icon name="check" className="size-3.5" />{t('saved')}</> : save === 'failed' ? t('saveFailed') : ''}
            </p>
          </div>
        </div>
        <span aria-hidden className="block h-0.5 bg-gold transition-[width] duration-500" style={{ width: `${(answeredCount / Math.max(1, tasks.length)) * 100}%` }} />
      </div>

      <section className="container-page grid gap-8 py-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10">
        <article className="min-w-0 lg:sticky lg:top-40 lg:max-h-[calc(100svh-11rem)] lg:self-start lg:overflow-y-auto">
          <p className="text-sm font-semibold text-gold-text">{t('taskOf', { current: number(locale, index + 1), total: number(locale, tasks.length) })}</p>
          <h1 className="page-title mt-2">{pick(locale, task.title_ar, task.title_en)}</h1>
          <p className="mt-4 leading-relaxed whitespace-pre-line text-foreground/90">{pick(locale, task.instructions_ar, task.instructions_en)}</p>

          {(deliverables?.length || task.config.materials?.length || task.config.accepted_formats?.length) ? (
            <div className="panel mt-6 divide-y divide-border text-sm">
              {deliverables?.length ? (
                <div className="p-4"><p className="font-semibold">{t('deliverables')}</p><ul className="mt-2 space-y-1.5">{deliverables.map((d) => <li key={d} className="flex gap-2"><span aria-hidden className="mt-1.5 size-1.5 shrink-0 rotate-45 bg-gold" />{d}</li>)}</ul></div>
              ) : null}
              {task.config.materials?.length ? (
                <div className="p-4"><p className="font-semibold">{t('materials')}</p><ul className="mt-2 space-y-1.5">{task.config.materials.filter((m) => m.url.startsWith('https://')).map((m) => <li key={m.url}><a href={m.url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1.5"><Icon name="external" className="size-3.5" />{m.title}</a></li>)}</ul></div>
              ) : null}
              {task.config.accepted_formats?.length ? <p className="p-4"><span className="font-semibold">{t('acceptedFormats')}: </span><bdi>{task.config.accepted_formats.join(', ')}</bdi></p> : null}
            </div>
          ) : null}
          {task.config.dataset_csv && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold">{t('dataset')}</h2>
                <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(task.config.dataset_csv)}`} download={task.config.dataset_name} className="link text-sm">{t('download')}</a>
              </div>
              <CsvTable csv={task.config.dataset_csv} />
            </div>
          )}
        </article>

        <div className="min-w-0">
          {task.task_type === 'objective_questions' ? (
            <div className="space-y-8">
              {(task.config.questions ?? []).map((q, qi) => (
                <fieldset key={q.id} className="panel panel-body">
                  <legend className="sr-only">{pick(locale, q.prompt_ar, q.prompt_en)}</legend>
                  <p aria-hidden className="font-semibold"><span className="num me-2 text-gold-text">{number(locale, qi + 1)}</span>{pick(locale, q.prompt_ar, q.prompt_en)}</p>
                  <div className="mt-4 space-y-2">
                    {q.options.map((o) => {
                      const chosen = answer.choices?.[q.id] === o.id;
                      return (
                        <label key={o.id} className={clsx('flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border p-3.5 transition-colors', chosen ? 'border-primary bg-accent/60' : 'border-border hover:border-border-strong')}>
                          <input
                            type="radio" name={q.id} value={o.id} checked={chosen}
                            onChange={() => update(task, { choices: { ...answer.choices, [q.id]: o.id } })}
                            className="size-4"
                          />
                          {pick(locale, o.label_ar, o.label_en)}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              <label className="block">
                <span className="field-label">{t('yourAnswer')}</span>
                <textarea
                  rows={14} value={answer.text ?? ''} placeholder={t('placeholder')}
                  onChange={(e) => update(task, { text: e.target.value })}
                  className="input min-h-80 p-4 leading-relaxed"
                />
              </label>
              {!preview && (
                <div className="rounded-[var(--radius-panel)] border border-dashed border-border-strong bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      <span aria-hidden className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-accent text-accent-foreground"><Icon name="file" /></span>
                      <span className="text-sm text-muted">{t('uploadHint')}</span>
                    </span>
                    <label className={clsx('btn btn-secondary btn-sm cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-primary', uploading && 'opacity-60')}>
                      <input type="file" className="sr-only" disabled={uploading} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                      {uploading && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
                      {uploading ? t('uploading') : t('upload')}
                    </label>
                  </div>
                  <div className="mt-2"><ErrorText code={uploadError} /></div>
                  {taskFiles.length > 0 && (
                    <div className="mt-4 border-t border-border pt-3 text-sm">
                      <p className="font-medium">{t('uploaded')}</p>
                      <ul className="mt-1.5 space-y-1" dir="ltr">{taskFiles.map((f) => <li key={f.id} className="flex items-center gap-2 text-muted"><Icon name="check" className="size-4 text-success" />{f.file_name}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
            <button type="button" disabled={index === 0} onClick={() => setView(index - 1)} className="btn btn-ghost disabled:invisible"><Icon name="chevron" className="size-4 rotate-180" />{t('previous')}</button>
            <button type="button" onClick={() => setView(index + 1 < tasks.length ? index + 1 : 'review')} className={clsx(PRIMARY, 'btn-lg')}>
              {index + 1 < tasks.length ? t('next') : t('review')}<Arrow />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
