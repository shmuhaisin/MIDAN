'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { removeRequirement, saveRequirement, setTaskRequirements } from '@/lib/actions';
import { list, number, pick } from '@/lib/format';
import { REQUIREMENT_TYPES, requirementText } from '@/lib/requirements';
import { ErrorText, Field, INPUT, PRIMARY } from './forms';

export type Requirement = {
  id: string; requirement_type: string; description_ar: string | null; description_en: string | null; is_mandatory: boolean; min_years: string | null;
  task_requirement_mappings: { assessment_tasks: { id: string; position: number; title_ar: string; title_en: string; version_id: string; assessment_versions: { assessments: { title_ar: string; title_en: string } } } }[];
};

function RequirementForm({ orgId, jobId, initial, onDone }: { orgId: string; jobId: string; initial?: Requirement; onDone: () => void }) {
  const t = useTranslations('requirements');
  const [type, setType] = useState(initial?.requirement_type ?? 'responsibility');
  const [ar, setAr] = useState(initial?.description_ar ?? '');
  const [en, setEn] = useState(initial?.description_en ?? '');
  const [mandatory, setMandatory] = useState(initial?.is_mandatory ?? true);
  const [years, setYears] = useState(initial?.min_years == null ? '' : String(Number(initial.min_years)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ar.trim() && !en.trim()) return setMissing(true);
    setMissing(false);
    start(async () => {
      const result = await saveRequirement(orgId, jobId, initial?.id ?? null, {
        requirement_type: type, description_ar: ar.trim() || null, description_en: en.trim() || null, is_mandatory: mandatory,
        min_years: type === 'experience' && years !== '' ? Number(years) : null,
      });
      setError(result.error);
      if (result.ok) onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg bg-surface p-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="field-label">{t('typeLabel')}</span>
        <select value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
          {REQUIREMENT_TYPES.map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="field-label">{t('textAr')}</span>
        <textarea dir="rtl" rows={2} maxLength={4000} value={ar} onChange={(e) => setAr(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
      </label>
      <label className="block">
        <span className="field-label">{t('textEn')}</span>
        <textarea dir="ltr" rows={2} maxLength={4000} value={en} onChange={(e) => setEn(e.target.value)} className={clsx(INPUT, 'h-auto py-2.5')} />
      </label>
      {type === 'experience' && (
        <Field name="min_years" type="number" min={0} max={70} step={0.5} label={t('minYears')} value={years} onChange={(e) => setYears(e.target.value)} />
      )}
      <label className="flex items-center gap-2 self-center text-sm font-medium">
        <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        {t('mandatory')}
      </label>
      <div className="sm:col-span-2">
        {missing && <p role="alert" className="mb-2 rounded-lg border-s-2 border-error bg-surface-2 px-3.5 py-2.5 text-sm">{t('needText')}</p>}
        <ErrorText code={error} />
        <div className="mt-2 flex items-center gap-4">
          <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('save')}</button>
          <button type="button" onClick={onDone} className="font-semibold">{t('cancel')}</button>
        </div>
      </div>
    </form>
  );
}

function RequirementRow({ orgId, jobId, requirement, versionIds, showAssessment, canEdit }: { orgId: string; jobId: string; requirement: Requirement; versionIds: string[]; showAssessment: boolean; canEdit: boolean }) {
  const t = useTranslations('requirements');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const tasks = requirement.task_requirement_mappings.map((m) => m.assessment_tasks).filter((task) => versionIds.includes(task.version_id));

  if (editing) return <li className="py-3"><RequirementForm orgId={orgId} jobId={jobId} initial={requirement} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="leading-relaxed"><bdi>{requirementText(locale, requirement)}</bdi></p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-medium text-muted">{t(requirement.is_mandatory ? 'mandatory' : 'optional')}</span>
          {requirement.min_years != null && <span className="text-muted">{t('years', { count: number(locale, Number(requirement.min_years)) })}</span>}
          {versionIds.length > 0 && (tasks.length > 0
            ? <span className="text-primary">{t('measuredBy', { tasks: list(locale, tasks.map((task) => {
                const title = pick(locale, task.title_ar, task.title_en);
                const assessment = task.assessment_versions.assessments;
                return showAssessment ? `${pick(locale, assessment.title_ar, assessment.title_en)}: ${title}` : title;
              })) })}</span>
            : <span className="font-medium text-error">{t('notAssessed')}</span>)}
        </p>
        <ErrorText code={error} />
      </div>
      {canEdit && (
        <div className="flex gap-3 text-sm">
          <button type="button" onClick={() => setEditing(true)} className="font-semibold underline underline-offset-4">{t('edit')}</button>
          <button
            type="button" disabled={pending}
            onClick={() => start(async () => setError((await removeRequirement(orgId, requirement.id)).error))}
            className="text-muted underline underline-offset-4 disabled:opacity-60"
          >
            {t('remove')}
          </button>
        </div>
      )}
    </li>
  );
}

export function RequirementsEditor({ orgId, jobId, requirements, versionIds, canEdit }: { orgId: string; jobId: string; requirements: Requirement[]; versionIds: string[]; canEdit: boolean }) {
  const t = useTranslations('requirements');
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const required = requirements.filter((r) => r.is_mandatory);
  const covered = required.filter((r) => r.task_requirement_mappings.some((m) => versionIds.includes(m.assessment_tasks.version_id)));

  return (
    <div>
      <p className="text-muted">{t('lead')}</p>
      {versionIds.length > 0 && required.length > 0 && (
        <p role="status" className="mt-2 text-sm font-semibold">{t('coverage', { covered: number(locale, covered.length), total: number(locale, required.length) })}</p>
      )}
      {requirements.length === 0 && !adding && <p className="mt-3 text-muted">{t('empty')}</p>}
      <div className="mt-3 space-y-5">
        {REQUIREMENT_TYPES.filter((k) => requirements.some((r) => r.requirement_type === k)).map((k) => (
          <section key={k} aria-label={t(`type.${k}`)}>
            <h3 className="font-semibold">{t(`type.${k}`)}</h3>
            <ul className="divide-y divide-border border-t border-border">
              {requirements.filter((r) => r.requirement_type === k).map((r) => (
                <RequirementRow key={r.id} orgId={orgId} jobId={jobId} requirement={r} versionIds={versionIds} showAssessment={versionIds.length > 1} canEdit={canEdit} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4">
          <AnimatePresence initial={false} mode="wait">
            {adding ? (
              <motion.div key="form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <RequirementForm orgId={orgId} jobId={jobId} onDone={() => setAdding(false)} />
              </motion.div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary btn-sm">
                <span aria-hidden>+</span>{t('add')}
              </button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function TaskRequirementPicker({ orgId, taskId, requirements, selected, editable }: { orgId: string; taskId: string; requirements: Requirement[]; selected: string[]; editable: boolean }) {
  const t = useTranslations('requirements');
  const tw = useTranslations('workspace');
  const locale = useLocale();
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{t('measures')}</legend>
      {requirements.length === 0 ? (
        <p className="text-sm text-muted">{t('noRequirements')}</p>
      ) : (
        <ul className="space-y-1.5">
          {requirements.map((r) => (
            <li key={r.id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox" disabled={!editable} checked={chosen.has(r.id)} className="mt-0.5 size-4 accent-[var(--primary)]"
                  onChange={() => setChosen((all) => { const copy = new Set(all); if (copy.has(r.id)) copy.delete(r.id); else copy.add(r.id); return copy; })}
                />
                <bdi>{requirementText(locale, r)}</bdi>
              </label>
            </li>
          ))}
        </ul>
      )}
      {editable && requirements.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button" disabled={pending} aria-busy={pending}
            onClick={() => start(async () => setState(await setTaskRequirements(orgId, taskId, [...chosen])))}
            className="btn btn-secondary btn-sm"
          >
            {t('saveMapping')}
          </button>
          {state.ok && !pending && <span role="status" className="font-semibold text-primary">{tw('saved')}</span>}
        </div>
      )}
      <ErrorText code={state.error} />
    </fieldset>
  );
}
