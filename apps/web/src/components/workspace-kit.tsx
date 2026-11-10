import clsx from 'clsx';
import { Icon } from './icons';

/**
 * The shared vocabulary of the signed-in workspaces, taken from the approved reference screens: a masthead, panels
 * with a titled head, the six-stage colours, the candidate's lane, a compact stage meter and date tiles.
 * Server-safe: no hooks, so pages and client charts can both use it.
 */

/**
 * Stage colours, from first contact to the decision, built from the theme's own tokens: the soft tint deepening into the
 * primary, and the accent for hired. MIDAN's colours on MIDAN's pages; inside a workspace with an approved identity, the
 * company's (globals.css .org-themed); and correct in light and dark either way. Use them as CSS values (style), not as
 * SVG presentation attributes, which don't resolve var() or color-mix().
 */
export const STAGE_COLORS = [
  ...[18, 38, 58, 80, 100].map((p) => `color-mix(in oklab, var(--button) ${p}%, var(--accent))`),
  'var(--gold)',
];

/** Position of each application status on the six stages. Closed statuses have none: their last stage isn't recorded. */
export const STAGE_RANK: Record<string, number> = {
  submitted: 0, under_review: 1, assessment_invited: 2, assessment_in_progress: 2, assessment_submitted: 2, evaluated: 3, shortlisted: 4, hired: 5,
};

/** A page's masthead: whose workspace, the page's name, an optional line, and its controls at the end. */
export function Masthead({ eyebrow, title, lead, children }: { eyebrow?: React.ReactNode; title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-border-strong pb-6">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="label-caps">{eyebrow}</p>}
        <h1 className="display-lg mt-2 text-balance max-sm:text-[2.125rem] max-sm:leading-tight">{title}</h1>
        {lead && <p className="mt-3 leading-relaxed text-muted">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3 sm:ms-auto">{children}</div>}
    </header>
  );
}

/** A titled surface. `flush` drops the body padding for lists that run edge to edge. */
export function Panel({ id, title, lead, action, count, flush, className, children }: {
  id: string; title: string; lead?: React.ReactNode; action?: React.ReactNode; count?: string; flush?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={clsx('overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface', className)}>
      <div className={clsx('flex flex-wrap items-end justify-between gap-3 px-6 pt-6 lg:px-8', flush ? 'border-b border-border pb-5' : 'pb-1')}>
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-3 font-display text-xl font-bold">
            {title}
            {count !== undefined && <span className="num rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted">{count}</span>}
          </h2>
          {lead && <p className="mt-1 max-w-2xl text-sm text-muted">{lead}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? '' : 'px-6 pt-5 pb-6 lg:px-8 lg:pb-8'}>{children}</div>
    </section>
  );
}

/** A segmented control made of links: the choice lives in the address, so a view can be shared. */
export function Segmented({ label, items }: { label: string; items: { key: string; label: React.ReactNode; href: string; current: boolean; count?: string }[] }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <span className="inline-flex rounded-[var(--radius-control)] border border-border bg-surface p-0.5 text-sm">
        {items.map((i) => (
          <a key={i.key} href={i.href} aria-current={i.current ? 'true' : undefined}
            className={clsx('flex items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 whitespace-nowrap transition-colors', i.current ? 'bg-[var(--button)] font-semibold text-[var(--button-foreground)]' : 'text-muted hover:text-foreground')}>
            {i.label}
            {i.count !== undefined && <span className={clsx('num text-xs', i.current ? 'opacity-75' : 'text-muted')}>{i.count}</span>}
          </a>
        ))}
      </span>
    </nav>
  );
}

/** Where a group of applicants is now, as one stacked bar in the stage colours. */
export function StageBar({ segments, label, className }: { segments: { key: string; label: string; value: number }[]; label: string; className?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <span role="img" aria-label={label} className={clsx('flex h-2 overflow-hidden rounded-full bg-surface-2', className)}>
      {total > 0 && segments.map((s, i) => s.value > 0 && (
        <span key={s.key} title={`${s.label}: ${s.value}`} className="h-full" style={{ width: `${(s.value / total) * 100}%`, background: STAGE_COLORS[i] }} />
      ))}
    </span>
  );
}

/** A compact meter of one application's stage: six dots, the current one in gold. Closed applications show none lit. */
export function StageMeter({ status, label }: { status: string; label: string }) {
  const at = STAGE_RANK[status] ?? -1;
  return (
    <span role="img" aria-label={label} className="relative inline-flex w-24 items-center justify-between">
      <span aria-hidden className="absolute inset-x-0.5 top-1/2 h-px -translate-y-1/2 bg-border-strong" />
      {at > 0 && <span aria-hidden className="absolute start-0.5 top-1/2 h-px -translate-y-1/2 bg-primary" style={{ width: `calc((100% - 0.25rem) * ${at / 5})` }} />}
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} aria-hidden className={clsx('relative rounded-full', i < at ? 'size-1.5 bg-primary' : i === at ? (status === 'hired' ? 'size-2.5 bg-primary' : 'size-2.5 bg-gold ring-2 ring-gold/25') : 'size-1.5 border border-border-strong bg-surface')} />
      ))}
    </span>
  );
}

/** The candidate's lane for one application: the line drawn to where they are, the current station breathing. */
export function LaneTrack({ status, stations, label, delay = 0 }: { status: string; stations: number; label: string; delay?: number }) {
  const at = STAGE_RANK[status] ?? 0;
  const hired = status === 'hired';
  return (
    <div role="img" aria-label={label} className="relative h-4">
      <span aria-hidden className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border" />
      <span aria-hidden className="lane-fill absolute start-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary" style={{ width: `calc((100% - 1rem) * ${at / (stations - 1)})`, animationDelay: `${delay}ms` }} />
      <span aria-hidden className="absolute inset-0 flex items-center justify-between">
        {Array.from({ length: stations }, (_, i) => (
          <span key={i} className={clsx('relative grid place-items-center rounded-full',
            i < at ? 'size-3 bg-primary' : i === at ? (hired ? 'size-4 bg-primary ring-4 ring-mint/50' : 'lane-here size-4 bg-gold') : 'size-3 border-2 border-border-strong bg-surface')}>
            {i === at && hired && <Icon name="check" className="size-2.5 text-primary-foreground" />}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Station names above lanes, aligned with LaneTrack's stations. */
export function LaneHeader({ stations }: { stations: string[] }) {
  return (
    <span aria-hidden className="flex justify-between">
      {stations.map((s, i) => <span key={s} className={clsx('flex w-0 text-xs font-semibold whitespace-nowrap text-muted', i === 0 ? 'justify-start' : i === stations.length - 1 ? 'justify-end' : 'justify-center')}>{s}</span>)}
    </span>
  );
}

/** A calendar tile: the day large, the month under it. */
export function DateTile({ day, month, muted }: { day: string; month: string; muted?: boolean }) {
  return (
    <span aria-hidden className={clsx('grid w-14 shrink-0 place-items-center rounded-[var(--radius-control)] py-2', muted ? 'bg-surface-2 text-muted' : 'bg-[color-mix(in_srgb,var(--brand-mint)_35%,var(--surface))] text-forest dark:text-mint')}>
      <span className="num font-display text-2xl leading-none font-bold">{day}</span>
      <span className="text-[0.6875rem] font-semibold uppercase">{month}</span>
    </span>
  );
}
