'use client';

import clsx from 'clsx';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { setCareerTarget } from '@/lib/candidate-actions';
import { number } from '@/lib/format';
import { Arrow } from './brand';
import { ErrorText, useAction } from './forms';

/** The career workspace's own places, in the order of the journey. */
const PLACES = [
  ['/development', 'journey'],
  ['/development/roles', 'roles'],
  ['/development/skills', 'skills'],
  ['/development/learning', 'learning'],
  ['/development/practice', 'practice'],
  ['/development/levels', 'levels'],
] as const;

export function CareerNav() {
  const t = useTranslations('career.nav');
  const pathname = usePathname();
  const current = (href: string) => href === '/development' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label={t('label')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ol className="flex min-w-max gap-1 border-b border-border">
        {PLACES.map(([href, key], i) => (
          <li key={href}>
            <Link href={href} aria-current={current(href) ? 'page' : undefined}
              className={clsx('relative flex items-center gap-2 px-3 py-3 text-sm whitespace-nowrap transition-colors', current(href) ? 'font-semibold text-foreground' : 'text-muted hover:text-foreground')}>
              <span aria-hidden className="num text-xs text-gold-text">{String(i + 1).padStart(2, '0')}</span>
              {t(key)}
              {current(href) && <motion.span layoutId="career-nav" aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-gold" />}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Makes a job family the candidate's target. A target title the candidate typed is kept: the API stores both, and
 * replacing one shouldn't silently drop the other.
 */
export function ChooseRoleButton({ sector, family, keepTitle, current, className }: { sector: string; family: string; keepTitle?: string | null; current: boolean; className?: string }) {
  const t = useTranslations('career.roles');
  const router = useRouter();
  const { pending, error, fire } = useAction(async () => {
    const result = await setCareerTarget({ sector_code: sector, job_family_ar: family, ...(keepTitle && { job_title: keepTitle }) });
    if (!result.error) router.push('/development');
    return result;
  });
  if (current) return <span className={clsx('chip border-primary/40 text-primary', className)}>{t('current')}</span>;
  return (
    <span className={className}>
      <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className="btn btn-primary btn-sm">{pending ? t('choosing') : t('choose')}<Arrow /></button>
      <ErrorText code={error} />
    </span>
  );
}

type Level = { code: string; name: string; body: string };
type FieldExample = { label: string; skill: string; levels: string[] };

/**
 * The L0–L4 scale as a ladder the candidate can climb: each level's existing definition, what changes from the level
 * below (the two definitions side by side), and a worked example from one field. The candidate's released levels are
 * marked on it. Nothing here adds a criterion of its own.
 */
export function LevelLadder({ levels, fields, mine }: { levels: Level[]; fields: FieldExample[]; mine: { name: string; level: number }[] }) {
  const t = useTranslations('career.levels');
  const locale = useLocale();
  const [at, setAt] = useState(3);
  const [field, setField] = useState(0);
  const example = fields[field];
  const here = mine.filter((m) => m.level === at);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* Climbing upward: L0 at the bottom. In a reversed column `justify-end` packs the rungs at the top of the cell. */}
      <div role="radiogroup" aria-label={t('ladder')} className="relative flex flex-col-reverse justify-end gap-2 self-start lg:sticky lg:top-24">
        {levels.map((l, i) => {
          const count = mine.filter((m) => m.level === i).length;
          return (
            <button key={l.code} type="button" role="radio" aria-checked={at === i} onClick={() => setAt(i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setAt(Math.min(levels.length - 1, i + 1)); }
                if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setAt(Math.max(0, i - 1)); }
              }}
              tabIndex={at === i ? 0 : -1}
              className={clsx('group relative flex items-center gap-4 rounded-[var(--radius-control)] border px-4 py-3 text-start transition-colors',
                at === i ? 'border-deep bg-deep text-deep-foreground' : 'border-border bg-surface hover:border-foreground/40')}
              style={{ marginInlineStart: `${i * 0.9}rem` }}>
              <span className={clsx('num font-display text-2xl font-bold', at === i ? 'text-gold' : 'text-gold-text')}>{l.code}</span>
              <span className="min-w-0 flex-1 font-semibold">{l.name}</span>
              {count > 0 && <span className={clsx('num rounded-full px-2 py-0.5 text-xs font-semibold', at === i ? 'bg-gold text-deep' : 'bg-accent text-accent-foreground')}>{t('mineCount', { count: number(locale, count) })}</span>}
            </button>
          );
        })}
      </div>

      <motion.div key={at} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} aria-live="polite" className="min-w-0 space-y-6">
        <div>
          <p className="label-caps">{levels[at].code}</p>
          <h3 className="display-lg mt-2">{levels[at].name}</h3>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed">{levels[at].body}</p>
        </div>

        {at > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-control)] border border-dashed border-border-strong p-4">
              <p className="text-xs font-semibold text-muted">{t('from', { code: levels[at - 1].code })}</p>
              <p className="mt-1 text-sm leading-relaxed">{levels[at - 1].body}</p>
            </div>
            <div className="rounded-[var(--radius-control)] border border-primary/40 bg-accent/40 p-4">
              <p className="text-xs font-semibold text-primary">{t('to', { code: levels[at].code })}</p>
              <p className="mt-1 text-sm leading-relaxed">{levels[at].body}</p>
            </div>
          </div>
        )}

        <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{t('example', { skill: example.skill })}</p>
            <label className="text-sm">
              <span className="sr-only">{t('field')}</span>
              <select value={field} onChange={(e) => setField(Number(e.target.value))} className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm">
                {fields.map((f, i) => <option key={f.label} value={i}>{f.label}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-3 leading-relaxed">{example.levels[at]}</p>
          <p className="mt-3 text-xs text-muted">{t('exampleNote')}</p>
        </div>

        <div>
          <p className="text-sm font-semibold">{t('mineTitle', { code: levels[at].code })}</p>
          {here.length > 0
            ? <ul className="mt-2 flex flex-wrap gap-2">{here.map((m) => <li key={m.name} className="chip">{m.name}</li>)}</ul>
            : <p className="mt-1 text-sm text-muted">{mine.length === 0 ? t('mineNone') : t('mineNoneHere')}</p>}
        </div>

        {at < levels.length - 1 && (
          <div className="border-s-2 border-gold ps-4">
            <p className="text-sm font-semibold">{t('nextTitle', { code: levels[at + 1].code })}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t('nextBody', { next: levels[at + 1].body })}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/development/practice" className="link text-sm">{t('toPractice')}</Link>
              <Link href="/assessments" className="link text-sm">{t('toAssessments')}</Link>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
