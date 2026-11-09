'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { saveOnboarding, saveProfileList, type HistoryItem } from '@/lib/candidate-actions';
import { Arrow } from './brand';
import { ErrorText, PRIMARY, useAction } from './forms';
import { Icon } from './icons';

type Kind = 'education' | 'experience';
const FIELDS: Record<Kind, { key: string; required?: boolean; type?: 'year' | 'long' }[]> = {
  education: [{ key: 'qualification', required: true }, { key: 'institution' }, { key: 'field' }, { key: 'start_year', type: 'year' }, { key: 'end_year', type: 'year' }],
  experience: [{ key: 'title', required: true }, { key: 'organization' }, { key: 'start_year', type: 'year' }, { key: 'end_year', type: 'year' }, { key: 'description', type: 'long' }],
};
const SECOND: Record<Kind, string[]> = { education: ['institution', 'field'], experience: ['organization'] };
const YEAR_NOW = new Date().getFullYear();

type Row = Record<string, string>;
const toRow = (item: Record<string, unknown>): Row => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v == null ? '' : String(v)]));
const isFilled = (r: Row) => Object.values(r).some((v) => v.trim());

/**
 * One onboarding step for one list of the profile, as a composer: saved entries fold into short summaries, and one
 * entry is open for editing at a time. It validates as you go (a required field, years in order), saves only this list,
 * and lets you skip: these steps are optional, and the profile page can complete them later.
 */
export function OnboardingList({ kind, fullName, initial, step, next, back }: { kind: Kind; fullName: string; initial: Record<string, unknown>[]; step: number; next: string; back?: React.ReactNode }) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial.map(toRow) : [{}]));
  const [open, setOpen] = useState<number | null>(() => (initial.length ? null : 0));
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const fields = FIELDS[kind];
  const required = fields.find((f) => f.required)!.key;
  const problemOf = (r: Row) => {
    if (!isFilled(r)) return null;
    if (!r[required]?.trim()) return 'required';
    const s = Number(r.start_year), e = Number(r.end_year);
    if (r.start_year && r.end_year && e < s) return 'invalid_years';
    if ([r.start_year, r.end_year].some((y) => y && (Number(y) < 1950 || Number(y) > YEAR_NOW + 6))) return 'invalid_year';
    return null;
  };
  const filled = rows.filter(isFilled);

  const { pending, error, fire } = useAction(async () => {
    const bad = rows.findIndex((r) => problemOf(r));
    if (bad >= 0) {
      setChecked(new Set(rows.map((_, i) => i)));
      setOpen(bad);
      return { error: problemOf(rows[bad])! };
    }
    const items: HistoryItem[] = filled.map((r) => Object.fromEntries(fields.map((f) => [f.key, f.type === 'year' ? (r[f.key] ? Number(r[f.key]) : null) : r[f.key]?.trim() || undefined])));
    const saved = await saveProfileList(fullName, kind, items);
    if (!saved.ok) return saved;
    const moved = await saveOnboarding(step);
    if (moved.ok) router.push(next);
    return moved;
  });
  const skip = useAction(async () => {
    const moved = await saveOnboarding(step);
    if (moved.ok) router.push(next);
    return moved;
  });

  const update = (i: number, key: string, value: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const remove = (i: number) => {
    setRows(rows.filter((_, j) => j !== i));
    setOpen(open === i ? null : open !== null && open > i ? open - 1 : open);
  };
  const close = (i: number) => {
    setChecked(new Set(checked).add(i));
    if (problemOf(rows[i])) return;
    if (isFilled(rows[i])) setOpen(null);
    else remove(i);
  };
  const add = () => {
    setRows([...rows, {}]);
    setOpen(rows.length);
  };
  const years = (r: Row) => [r.start_year, r.end_year].filter(Boolean).join(' – ');

  return (
    <form onSubmit={(e) => { e.preventDefault(); fire(); }} noValidate>
      <ErrorText code={error} />
      <ol className="space-y-3">
        {rows.map((row, i) => {
          const problem = checked.has(i) ? problemOf(row) : null;
          if (open !== i) {
            const sub = SECOND[kind].map((k) => row[k]).filter(Boolean).join(' · ');
            return (
              <li key={i} className={clsx('flex items-center gap-4 rounded-[var(--radius-panel)] border bg-surface p-4 sm:px-5', problem ? 'border-error' : 'border-border')}>
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,transparent)] text-forest dark:text-mint">
                  <Icon name={kind === 'education' ? 'layers' : 'briefcase'} className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{row[required] || t('untitled')}</span>
                  {(sub || years(row)) && <span className="block truncate text-sm text-muted">{[sub, years(row)].filter(Boolean).join(' · ')}</span>}
                  {problem && <span className="block text-sm text-error">{t(`problem.${problem}`)}</span>}
                </span>
                <button type="button" onClick={() => setOpen(i)} className="btn btn-ghost btn-sm">{t('edit')}</button>
                <button type="button" onClick={() => remove(i)} aria-label={`${t('remove')}: ${row[required] || t('untitled')}`} className="btn btn-ghost btn-sm px-2 text-muted"><Icon name="close" className="size-4" /></button>
              </li>
            );
          }
          return (
            <li key={i}>
              <fieldset className="rounded-[var(--radius-panel)] border border-primary/40 bg-surface p-5 shadow-[0_18px_40px_-32px_rgb(11_61_46/0.6)] sm:p-6" aria-describedby={problem ? `row-${kind}-${i}` : undefined}>
                <legend className="sr-only">{t(`${kind}.item`, { n: i + 1 })}</legend>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gold-text">{t(`${kind}.item`, { n: i + 1 })}</p>
                  {rows.length > 1 && <button type="button" onClick={() => remove(i)} className="btn btn-ghost btn-sm text-muted"><Icon name="close" className="size-4" />{t('remove')}</button>}
                </div>
                <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                  {fields.map((f) => (
                    <label key={f.key} className={f.type === 'long' || f.required || f.key === 'organization' ? 'block sm:col-span-2' : 'block'}>
                      <span className="field-label">{t(`${kind}.${f.key}`)}{f.required ? <span className="text-error"> *</span> : <span className="font-normal text-muted"> · {t('optional')}</span>}</span>
                      {f.type === 'long'
                        ? <textarea rows={3} maxLength={2000} value={row[f.key] ?? ''} onChange={(e) => update(i, f.key, e.target.value)} className="input" />
                        : <input
                            value={row[f.key] ?? ''} onChange={(e) => update(i, f.key, e.target.value)} maxLength={f.type === 'year' ? 4 : 200}
                            inputMode={f.type === 'year' ? 'numeric' : undefined} dir={f.type === 'year' ? 'ltr' : undefined}
                            aria-invalid={Boolean(problem && (f.required ? problem === 'required' : f.type === 'year'))}
                            className="input"
                          />}
                    </label>
                  ))}
                </div>
                {problem && <p id={`row-${kind}-${i}`} className="mt-4 text-sm text-error">{t(`problem.${problem}`)}</p>}
                <div className="mt-5 flex justify-end border-t border-border pt-4">
                  <button type="button" onClick={() => close(i)} className="btn btn-secondary btn-sm"><Icon name="check" className="size-4" />{t('entryDone')}</button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      {rows.length === 0 && <p className="rounded-[var(--radius-panel)] border border-dashed border-border-strong px-5 py-8 text-center text-sm text-muted">{t(`${kind}.empty`)}</p>}
      {open === null && (
        <button type="button" onClick={add} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-border-strong px-4 py-4 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-surface">
          <span aria-hidden className="text-lg leading-none">+</span>{t(`${kind}.add`)}
        </button>
      )}
      <div className="ob-actions">
        {back}
        <span className="flex-1" />
        <button type="button" disabled={skip.pending} onClick={skip.fire} className="btn btn-ghost">{t('skip')}</button>
        <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('saveContinue')}<Arrow /></button>
        <ErrorText code={skip.error} />
      </div>
    </form>
  );
}
