'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { addAssessment, generateAssessment, inviteCandidate, publishVersion, removeAssessment, renameAssessment, setAssessmentField, updateCriterion, updateJob, updateTask } from '@/lib/actions';
import type { FormState } from '@/lib/auth-actions';
import { list, pick } from '@/lib/format';
import { PROFESSIONAL_FIELDS } from '@/lib/humaidan';
import { Arrow } from './brand';
import { ActionForm, ErrorText, Field, INPUT, PRIMARY, Submit, useAction } from './forms';
import { saveVersionSettings } from '@/lib/candidate-actions';
import { TaskRequirementPicker, type Requirement } from './requirements';

function TextArea({ label, hint, name, ...props }: { label: string; hint?: string; name: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <textarea name={name} rows={4} className={clsx(INPUT, 'h-auto py-2.5 leading-relaxed')} {...props} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Saved({ show, label }: { show?: boolean; label: string }) {
  if (!show) return null;
  return <motion.span role="status" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="font-semibold text-primary">{label}</motion.span>;
}

type Skill = { id: string; name_ar: string; name_en: string };
type JobDetails = {
  id: string; title_ar: string; title_en: string; description_ar: string | null; description_en: string | null;
  requirements_ar: string | null; requirements_en: string | null; location: string | null;
  employment_type: string | null; salary_min: string | null; salary_max: string | null; application_deadline: string | null; sector: string | null; experience_level: string | null;
  job_skills: { skill_id: string; required_level: number }[];
};

/** What candidates are told and how long they have. The company approves this along with the assessment. */
export function VersionSettings({ orgId, version, canEdit }: { orgId: string; version: { id: string; scenario_ar: string | null; scenario_en: string | null; deadline_hours: number | null; duration_minutes: number | null; is_timed: boolean; rubric_shared: boolean }; canEdit: boolean }) {
  const t = useTranslations('workspace');
  const [scenarioAr, setScenarioAr] = useState(version.scenario_ar ?? '');
  const [scenarioEn, setScenarioEn] = useState(version.scenario_en ?? '');
  const [deadline, setDeadline] = useState(version.deadline_hours == null ? '' : String(version.deadline_hours));
  const [minutes, setMinutes] = useState(version.duration_minutes == null ? '' : String(version.duration_minutes));
  const [timed, setTimed] = useState(version.is_timed);
  const [shared, setShared] = useState(version.rubric_shared);
  const [saved, setSaved] = useState(false);
  const { pending, error, fire } = useAction(async () => {
    const result = await saveVersionSettings(orgId, version.id, {
      scenario_ar: scenarioAr, scenario_en: scenarioEn, is_timed: timed, rubric_shared: shared,
      ...(deadline && { deadline_hours: Number(deadline) }), ...(minutes && { duration_minutes: Number(minutes) }),
    });
    setSaved(Boolean(result.ok));
    return result;
  });
  return (
    <form className="space-y-3 rounded-lg bg-surface p-4" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <p className="font-semibold">{t('candidateSettings')}</p>
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="text-sm font-medium">{t('scenarioAr')}</span><textarea dir="rtl" rows={2} value={scenarioAr} onChange={(e) => setScenarioAr(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} /></label>
        <label className="block"><span className="text-sm font-medium">{t('scenarioEn')}</span><textarea dir="ltr" rows={2} value={scenarioEn} onChange={(e) => setScenarioEn(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} /></label>
        <Field name="deadline_hours" type="number" min={1} max={2160} label={t('deadlineHours')} hint={t('deadlineHint')} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <Field name="duration_minutes" type="number" min={1} max={1440} label={t('durationMinutes')} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="size-4 accent-[var(--primary)]" />{t('isTimed')}</label>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 accent-[var(--primary)]" />{t('shareRubric')}</label>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} aria-busy={pending} className="rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold">{t('saveSettings')}</button>
          {saved && !pending && <span role="status" className="text-sm font-semibold text-primary">{t('saved')}</span>}
        </div>
      )}
      <ErrorText code={error} />
    </form>
  );
}

export function JobDetailsForm({ orgId, job, skills, canEdit }: { orgId: string; job: JobDetails; skills: Skill[]; canEdit: boolean }) {
  const t = useTranslations('workspace');
  const ts = useTranslations('sectors');
  const tj = useTranslations('jobs');
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(updateJob.bind(null, orgId, job.id), {});
  const selected = new Map(job.job_skills.map((s) => [s.skill_id, s.required_level]));
  return (
    <ActionForm action={action}>
      <fieldset disabled={!canEdit} className="space-y-4">
        <ErrorText code={state.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="title_ar" required dir="rtl" label={t('titleAr')} defaultValue={job.title_ar} />
          <Field name="title_en" required dir="ltr" label={t('titleEn')} defaultValue={job.title_en} />
          <TextArea name="description_ar" dir="rtl" label={t('descriptionAr')} hint={t('descriptionHint')} defaultValue={job.description_ar ?? ''} />
          <TextArea name="description_en" dir="ltr" label={t('descriptionEn')} hint={t('descriptionHint')} defaultValue={job.description_en ?? ''} />
          <TextArea name="requirements_ar" dir="rtl" rows={3} label={t('requirementsAr')} defaultValue={job.requirements_ar ?? ''} />
          <TextArea name="requirements_en" dir="ltr" rows={3} label={t('requirementsEn')} defaultValue={job.requirements_en ?? ''} />
          <Field name="location" label={t('location')} defaultValue={job.location ?? ''} />
          <label className="block">
            <span className="text-sm font-medium">{t('sector')}</span>
            <select name="sector" defaultValue={job.sector ?? ''} className={INPUT}>
              <option value="">{t('notSpecified')}</option>
              {['digital', 'culture_entertainment', 'tourism_hospitality', 'manufacturing', 'construction_real_estate', 'financial_services', 'wholesale_retail', 'other'].map((k) => <option key={k} value={k}>{ts(k)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('experienceLevel')}</span>
            <select name="experience_level" defaultValue={job.experience_level ?? ''} className={INPUT}>
              <option value="">{t('notSpecified')}</option>
              {['entry', 'junior', 'mid', 'senior', 'lead'].map((k) => <option key={k} value={k}>{tj(`level.${k}`)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('employmentType')}</span>
            <select name="employment_type" defaultValue={job.employment_type ?? ''} className={INPUT}>
              <option value="">{t('notSpecified')}</option>
              {['full_time', 'part_time', 'contract', 'temporary', 'internship', 'flexible'].map((k) => <option key={k} value={k}>{t(`employment.${k}`)}</option>)}
            </select>
          </label>
          <Field name="salary_min" type="number" min={0} label={t('salaryMin')} defaultValue={job.salary_min == null ? '' : Number(job.salary_min)} />
          <Field name="salary_max" type="number" min={0} label={t('salaryMax')} defaultValue={job.salary_max == null ? '' : Number(job.salary_max)} />
          <Field name="application_deadline" type="date" label={t('deadline')} defaultValue={job.application_deadline?.slice(0, 10) ?? ''} />
        </div>
        <div>
          <p className="text-sm font-medium">{t('skills')}</p>
          <p className="text-xs text-muted">{t('draftSkillsNote')}</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {skills.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="skill" value={s.id} defaultChecked={selected.has(s.id)} className="size-4 accent-[var(--primary)]" />
                  {pick(locale, s.name_ar, s.name_en)}
                </label>
                <select name={`level-${s.id}`} aria-label={`${t('requiredLevel')}: ${pick(locale, s.name_ar, s.name_en)}`} defaultValue={selected.get(s.id) ?? 3} className="rounded border border-border bg-surface px-1.5 py-1 text-sm">
                  {[1, 2, 3, 4].map((l) => <option key={l} value={l}>L{l}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>
        {canEdit && (
          <div className="flex items-center gap-4">
            <Submit>{t('save')}</Submit>
            <Saved show={state.ok} label={t('saved')} />
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}

export function GenerateButton({ orgId, jobId, assessmentId, label }: { orgId: string; jobId: string; assessmentId?: string; label: string }) {
  const t = useTranslations('workspace');
  const { pending, error, fire } = useAction(() => generateAssessment(orgId, jobId, assessmentId));
  return (
    <div className="space-y-3">
      <button type="button" onClick={fire} disabled={pending} aria-busy={pending} className={PRIMARY}>
        {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
        {pending ? t('generating') : label}
      </button>
      <ErrorText code={error} />
    </div>
  );
}

export function EmptyAssessment({ orgId, jobId }: { orgId: string; jobId: string }) {
  const t = useTranslations('workspace');
  return (
    <div className="rounded-lg bg-surface p-6">
      <h3 className="font-display text-xl font-semibold">{t('noAssessmentTitle')}</h3>
      <p className="mt-1 mb-4 text-muted">{t('noAssessmentBody')}</p>
      <GenerateButton orgId={orgId} jobId={jobId} label={t('generate')} />
    </div>
  );
}

type AssessmentSummary = { id: string; title_ar: string; title_en: string; assessment_versions: { status: string }[] };

export function AssessmentSwitcher({ orgId, jobId, assessments, selected, canBuild }: { orgId: string; jobId: string; assessments: AssessmentSummary[]; selected: string; canBuild: boolean }) {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function create(form: FormData) {
    start(async () => {
      const made = await addAssessment(orgId, jobId, form);
      setError(made.error);
      if (made.assessmentId) {
        setAdding(false);
        router.push(`/organization/${orgId}/jobs/${jobId}?assessment=${made.assessmentId}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <nav aria-label={t('assessmentsLabel')} className="flex flex-wrap items-center gap-2">
        {assessments.map((a) => {
          const current = a.id === selected;
          return (
            <Link
              key={a.id} href={`/organization/${orgId}/jobs/${jobId}?assessment=${a.id}`} aria-current={current ? 'page' : undefined}
              className={clsx('rounded-full border px-4 py-2 text-sm font-semibold transition-colors', current ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-surface-2')}
            >
              {pick(locale, a.title_ar, a.title_en)}
              <span className="ms-2 font-medium opacity-80">{t(`status.${a.assessment_versions[0]?.status ?? 'draft'}`)}</span>
            </Link>
          );
        })}
        {canBuild && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-full border border-foreground/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-2">
            <span aria-hidden>+</span>{t('addAssessment')}
          </button>
        )}
      </nav>
      {adding && (
        <form
          className="grid gap-3 rounded-lg bg-surface p-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); create(new FormData(e.currentTarget)); }}
        >
          <Field name="title_ar" dir="rtl" required maxLength={200} label={t('assessmentTitleAr')} />
          <Field name="title_en" dir="ltr" required maxLength={200} label={t('assessmentTitleEn')} />
          <div className="sm:col-span-2">
            <p className="mb-3 text-sm text-muted">{t('addAssessmentHint')}</p>
            <ErrorText code={error} />
            <div className="mt-2 flex items-center gap-4">
              <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
                {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />}
                {pending ? t('generating') : t('createAssessment')}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="font-semibold">{t('cancelAction')}</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export function AssessmentTitle({ orgId, jobId, assessment, canEdit, canRemove }: { orgId: string; jobId: string; assessment: { id: string; title_ar: string; title_en: string }; canEdit: boolean; canRemove: boolean }) {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function save(form: FormData) {
    start(async () => {
      const done = await renameAssessment(orgId, assessment.id, form);
      setError(done.error);
      if (!done.error) setRenaming(false);
    });
  }
  function remove() {
    start(async () => {
      const done = await removeAssessment(orgId, assessment.id);
      setError(done.error);
      if (!done.error) router.push(`/organization/${orgId}/jobs/${jobId}`);
    });
  }

  if (renaming) {
    return (
      <form className="grid gap-3 rounded-lg bg-surface p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(new FormData(e.currentTarget)); }}>
        <Field name="title_ar" dir="rtl" required maxLength={200} label={t('assessmentTitleAr')} defaultValue={assessment.title_ar} />
        <Field name="title_en" dir="ltr" required maxLength={200} label={t('assessmentTitleEn')} defaultValue={assessment.title_en} />
        <div className="sm:col-span-2">
          <ErrorText code={error} />
          <div className="mt-2 flex items-center gap-4">
            <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('saveTitle')}</button>
            <button type="button" onClick={() => setRenaming(false)} className="font-semibold">{t('cancelAction')}</button>
          </div>
        </div>
      </form>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="font-display text-2xl font-semibold">{pick(locale, assessment.title_ar, assessment.title_en)}</h3>
        {canEdit && <button type="button" onClick={() => setRenaming(true)} className="text-sm font-semibold underline underline-offset-4">{t('renameAssessment')}</button>}
        {canRemove && (confirming ? (
          <span className="flex items-center gap-3 text-sm">
            <button type="button" disabled={pending} aria-busy={pending} onClick={remove} className="font-semibold text-error underline underline-offset-4 disabled:opacity-60">{t('confirmRemoveAssessment')}</button>
            <button type="button" onClick={() => setConfirming(false)} className="font-semibold">{t('cancelAction')}</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted underline underline-offset-4">{t('removeAssessment')}</button>
        ))}
      </div>
      <ErrorText code={error} />
    </div>
  );
}

export function FieldSelect({ orgId, assessmentId, field, canEdit }: { orgId: string; assessmentId: string; field: string | null; canEdit: boolean }) {
  const t = useTranslations('workspace');
  const tf = useTranslations('fields');
  const [value, setValue] = useState(field ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  return (
    <label className="block max-w-md">
      <span className="text-sm font-semibold">{t('field')}</span>
      <select
        value={value}
        disabled={!canEdit || pending}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          setSaved(false);
          start(async () => {
            const result = await setAssessmentField(orgId, assessmentId, next || null);
            setError(result.error);
            setSaved(Boolean(result.ok));
          });
        }}
        className={clsx(INPUT, 'disabled:opacity-60')}
      >
        <option value="">{t('fieldInherit')}</option>
        {PROFESSIONAL_FIELDS.map((f) => <option key={f} value={f}>{tf(f)}</option>)}
      </select>
      <span className="mt-1 block text-xs text-muted">{t('fieldHint')} <Saved show={saved} label={t('saved')} /></span>
      <ErrorText code={error} />
    </label>
  );
}

type Criterion = { id: string; code: string; description_ar: string; description_en: string; max_score: string; weight: string; answer_key: unknown };
type Task = {
  id: string; position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string; weight: string;
  rubric_criteria: Criterion[]; task_skill_mappings: { skills: Skill }[]; task_requirement_mappings: { requirement_id: string }[];
};

function CriterionEditor({ orgId, criterion, editable }: { orgId: string; criterion: Criterion; editable: boolean }) {
  const t = useTranslations('workspace');
  const [state, action] = useActionState<FormState, FormData>(updateCriterion.bind(null, orgId, criterion.id), {});
  return (
    <ActionForm action={action} className="rounded-lg border border-border p-3">
      <fieldset disabled={!editable} className="space-y-3">
        <p className="text-xs font-semibold text-muted">{criterion.code}{criterion.answer_key ? ` · ${t('answerKeyNote')}` : ''}</p>
        <ErrorText code={state.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextArea name="description_ar" rows={2} dir="rtl" required label={t('descriptionAr').split(' ')[0]} aria-label={`${criterion.code} ar`} defaultValue={criterion.description_ar} />
          <TextArea name="description_en" rows={2} dir="ltr" required label={t('descriptionEn').split(' ')[0]} aria-label={`${criterion.code} en`} defaultValue={criterion.description_en} />
          <Field name="max_score" type="number" min="1" step="1" required label={t('maxScore')} defaultValue={Number(criterion.max_score)} />
          <Field name="weight" type="number" min="0.1" step="0.1" required label={t('weight')} defaultValue={Number(criterion.weight)} />
        </div>
        {editable && (
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-full border border-border px-3 py-1.5 text-sm font-semibold hover:bg-surface-2">{t('saveCriterion')}</button>
            <Saved show={state.ok} label={t('saved')} />
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}

function TaskEditor({ orgId, task, editable, requirements }: { orgId: string; task: Task; editable: boolean; requirements: Requirement[] }) {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(updateTask.bind(null, orgId, task.id), {});
  return (
    <li className="border-b border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-4 py-4 text-start">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground">{task.position}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{pick(locale, task.title_ar, task.title_en)}</span>
          <span className="block text-sm text-muted">
            {t(`taskType.${task.task_type}`)} · {list(locale, task.task_skill_mappings.map((m) => pick(locale, m.skills.name_ar, m.skills.name_en)))}
          </span>
        </span>
        <motion.span aria-hidden animate={{ rotate: open ? 45 : 0 }} className="text-xl">+</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-5 pb-6">
              <ActionForm action={action}>
                <fieldset disabled={!editable} className="space-y-3">
                  <ErrorText code={state.error} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field name="title_ar" required dir="rtl" label={t('taskTitleAr')} defaultValue={task.title_ar} />
                    <Field name="title_en" required dir="ltr" label={t('taskTitleEn')} defaultValue={task.title_en} />
                    <TextArea name="instructions_ar" required dir="rtl" rows={5} label={t('instructionsAr')} defaultValue={task.instructions_ar} />
                    <TextArea name="instructions_en" required dir="ltr" rows={5} label={t('instructionsEn')} defaultValue={task.instructions_en} />
                    <Field name="weight" type="number" min="0.1" step="0.1" required label={t('weight')} defaultValue={Number(task.weight)} />
                  </div>
                  {editable && (
                    <div className="flex items-center gap-3">
                      <Submit>{t('saveTask')}</Submit>
                      <Saved show={state.ok} label={t('saved')} />
                    </div>
                  )}
                </fieldset>
              </ActionForm>
              <TaskRequirementPicker
                orgId={orgId} taskId={task.id} requirements={requirements} editable={editable}
                selected={task.task_requirement_mappings.map((m) => m.requirement_id)}
              />
              <div>
                <p className="mb-2 text-sm font-semibold">{t('rubric')}</p>
                <div className="space-y-3">
                  {task.rubric_criteria.map((c) => <CriterionEditor key={c.id} orgId={orgId} criterion={c} editable={editable} />)}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function TaskList({ orgId, tasks, editable, requirements }: { orgId: string; tasks: Task[]; editable: boolean; requirements: Requirement[] }) {
  return <ul className="border-t border-border">{tasks.map((task) => <TaskEditor key={task.id} orgId={orgId} task={task} editable={editable} requirements={requirements} />)}</ul>;
}

export function PublishPanel({ orgId, versionId }: { orgId: string; versionId: string }) {
  const t = useTranslations('workspace');
  const [confirming, setConfirming] = useState(false);
  const { pending, error, fire } = useAction(() => publishVersion(orgId, versionId));
  return (
    <div className="rounded-lg bg-surface p-4">
      <p className="text-sm text-muted">{t('publishNote')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className={PRIMARY}>{t('publishConfirm')}</button>
            <button type="button" onClick={() => setConfirming(false)} className="font-semibold">{t('cancel')}</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={PRIMARY}>{t('publish')}<Arrow /></button>
        )}
      </div>
      <div className="mt-2"><ErrorText code={error} /></div>
    </div>
  );
}

export function InviteButton({ applicationId, assessmentId, title }: { applicationId: string; assessmentId: string; title: string }) {
  const t = useTranslations('workspace');
  const { pending, error, fire } = useAction(() => inviteCandidate(applicationId, assessmentId));
  return (
    <div>
      <button aria-label={t('inviteNamed', { title })} type="button" disabled={pending} aria-busy={pending} onClick={fire} className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{t('invite')}</button>
      <ErrorText code={error} />
    </div>
  );
}

