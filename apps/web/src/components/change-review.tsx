'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { changedFields, compareTasks, weakensCoverage, type Change, type Finding, type ReviewState } from '@/lib/assessment-review';
import { reviewChanges, reviseVersion } from '@/lib/actions';
import { pick } from '@/lib/format';
import { ErrorText, useAction } from './forms';

const CHECK_CODES = new Set([
  'requirement_not_measured', 'required_skill_not_measured', 'no_tasks', 'task_without_criteria', 'written_task_single_criterion', 'task_not_mapped',
  'criterion_skill_not_on_task', 'objective_without_questions', 'objective_answer_invalid', 'duplicate_task',
]);

function shown(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/** MIDAN's checks on the draft. Errors stop approval; warnings are shown to the approver and kept with the review. */
export function ValidationList({ findings }: { findings: Finding[] }) {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const line = (f: Finding) => t(`validation.${CHECK_CODES.has(f.code) ? f.code : 'no_tasks'}`, { text: pick(locale, f.text_ar ?? f.text_en ?? '', f.text_en ?? f.text_ar ?? '') });
  return (
    <div className="space-y-3">
      <h4 className="font-semibold">{t('validationTitle')}</h4>
      {findings.length === 0 && <p className="text-sm text-muted">{t('validationClean')}</p>}
      {errors.length > 0 && (
        <div role="alert" className="border-s-2 border-error ps-4 text-sm">
          <p className="font-semibold">{t('validationErrors')}</p>
          <ul className="mt-1 list-disc space-y-1 ps-4">{errors.map((f, i) => <li key={`e${i}`}>{line(f)}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="status" className="callout text-sm">
          <p className="font-semibold">{t('validationWarnings')}</p>
          <ul className="mt-1 list-disc space-y-1 ps-4">{warnings.map((f, i) => <li key={`w${i}`}>{line(f)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function ChangeItem({ change, titles }: { change: Change; titles: Map<string, string> }) {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const weakens = weakensCoverage(change);
  const fields = changedFields(change);
  const old = change.details.old as { title_ar?: string; title_en?: string } | null;
  const title = titles.get(change.details.task_id ?? '') ?? (old ? pick(locale, old.title_ar ?? '', old.title_en ?? '') : '');
  return (
    <li className={clsx('rounded-lg border p-3 text-sm', weakens ? 'border-error' : 'border-border')}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{t(`reviewAction.${change.action}`)} · {t(`reviewEntity.${change.entity}`)}</span>
        {title && <span className="text-muted">{title}</span>}
        {weakens && <span className="inline-flex rounded-[3px] bg-error-surface px-2 py-0.5 text-xs font-semibold text-error">{t('reviewWeakens')}</span>}
        {!change.needs_review && <span className="text-xs text-muted">{t('reviewSettingsOnly')}</span>}
      </p>
      <p className="mt-1 text-xs text-muted">
        {change.actor_name ?? '—'} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(change.created_at))}
        {' · '}{change.details.reason ? t('reviewReason', { reason: change.details.reason }) : t('reviewNoReason')}
      </p>
      {fields.length > 0 && (
        <dl className="mt-2 space-y-1">
          {fields.map(({ field, before, after }) => (
            <div key={field} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
              <dt><code className="text-xs">{field}</code></dt>
              <dd className="min-w-0 break-words">
                {change.action !== 'create' && <del className="text-muted">{shown(before)}</del>}
                {change.action === 'update' && ' → '}
                {change.action !== 'delete' && <ins className="no-underline">{shown(after)}</ins>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * The review before approval: what MIDAN generated beside the draft now, every change people made with its before and after
 * (the ones that weaken coverage first and marked), MIDAN's checks, and earlier reviews. Owners and admins record a review here,
 * or by approving in the panel below.
 */
export function ChangeReview({ orgId, state, canReview }: { orgId: string; state: ReviewState; canReview: boolean }) {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const [note, setNote] = useState('');
  const record = useAction(() => reviewChanges(orgId, state.version.id, state.latest_change_id, note));
  const reviewable = state.changes.filter((c) => c.needs_review);
  const ordered = [...state.changes].sort((a, b) => Number(weakensCoverage(b)) - Number(weakensCoverage(a)) || a.id - b.id);
  const titles = new Map([...(state.original?.content.tasks ?? []), ...state.current.tasks].map((task) => [task.id, pick(locale, task.title_ar, task.title_en)]));
  const rows = compareTasks(state.original?.content, state.current);
  const draft = state.version.status === 'draft' || state.version.status === 'in_review';
  return (
    <section aria-labelledby="change-review" className="space-y-5 rounded-lg border border-border p-4">
      <div>
        <h3 id="change-review" className="text-lg font-semibold">{t('reviewTitle')}</h3>
        <p className="mt-1 text-sm text-muted">
          {state.original?.kind === 'generated' ? t('reviewIntroGenerated')
            : state.original?.kind === 'revision_base' ? t('reviewIntroRevision', { number: state.version.version_number - 1 })
            : t('reviewNoOriginal')}
        </p>
        <p className="mt-2 text-sm font-semibold">
          {reviewable.length === 0 ? t('reviewNoChanges') : t('reviewChangeCount', { count: reviewable.length })}
          {reviewable.length > 0 && <span className={clsx('ms-2', state.unreviewed ? 'text-error' : 'text-accent-foreground')}>· {state.unreviewed ? t('reviewUnreviewed') : t('reviewDone')}</span>}
        </p>
      </div>

      <ValidationList findings={state.validation} />

      {state.original && (
        <div>
          <h4 className="font-semibold">{t('compareTitle')}</h4>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-muted"><span>{t('compareOriginal')}</span><span>{t('compareCurrent')}</span></div>
          <ul className="mt-1 space-y-2">
            {rows.map((row) => (
              <li key={(row.current ?? row.original)!.id} className={clsx('grid grid-cols-2 gap-2 rounded-lg p-2 text-sm', row.status === 'unchanged' ? 'bg-surface' : 'bg-surface-2')}>
                <span className={clsx(row.status === 'added' && 'text-muted')}>
                  {row.original ? `${row.original.position}. ${pick(locale, row.original.title_ar, row.original.title_en)} · ${t('compareCriteria', { count: row.original.criteria.length })}` : '—'}
                </span>
                <span>
                  {row.current ? `${row.current.position}. ${pick(locale, row.current.title_ar, row.current.title_en)} · ${t('compareCriteria', { count: row.current.criteria.length })}` : '—'}
                  <span className="ms-2 text-xs font-semibold">{t(`compareStatus.${row.status}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ordered.length > 0 && (
        <div>
          <h4 className="font-semibold">{t('reviewChanges')}</h4>
          <ol className="mt-2 space-y-2">{ordered.map((c) => <ChangeItem key={c.id} change={c} titles={titles} />)}</ol>
        </div>
      )}

      {state.reviews.length > 0 && (
        <div>
          <h4 className="font-semibold">{t('reviewHistory')}</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {state.reviews.map((r) => (
              <li key={r.id}>
                {t('reviewRecord', {
                  name: r.reviewer_name ?? '—', count: r.change_count, warnings: r.warnings,
                  time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.reviewed_at)),
                })}
                {r.note && <span className="text-muted"> · {r.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && canReview && state.unreviewed && (
        <div className="space-y-2">
          <label className="block">
            <span className="field-label">{t('reviewNote')}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="mt-1 block w-full rounded-lg border border-border bg-surface p-3" />
          </label>
          <button type="button" onClick={record.fire} disabled={record.pending} aria-busy={record.pending}
            className="btn btn-secondary btn-sm">
            {t('reviewMark')}
          </button>
          <ErrorText code={record.error} />
        </div>
      )}
    </section>
  );
}

/** Changing an assessment candidates already take: a new draft copied from this approved version, which stays as it is. */
export function ReviseButton({ orgId, versionId }: { orgId: string; versionId: string }) {
  const t = useTranslations('workspace');
  const { pending, error, fire } = useAction(() => reviseVersion(orgId, versionId));
  return (
    <div className="space-y-1">
      <button type="button" onClick={fire} disabled={pending} aria-busy={pending}
        className="btn btn-secondary btn-sm">
        {t('revise')}
      </button>
      <p className="text-sm text-muted">{t('reviseNote')}</p>
      <ErrorText code={error} />
    </div>
  );
}
