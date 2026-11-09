import clsx from 'clsx';

/**
 * MIDAN design system — shared presentational primitives. Server-safe: no hooks, no translations.
 * Every screen composes from these and the classes in globals.css (btn, input, card, panel, callout, chip, table-x).
 */

export function PageHeader({
  title,
  lead,
  eyebrow,
  children,
  className,
}: {
  title: string;
  lead?: string;
  eyebrow?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx('flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="mb-2 flex items-center gap-3 text-sm font-medium text-muted">
            <span aria-hidden className="h-px w-6 bg-gold" />
            {eyebrow}
          </p>
        )}
        <h1 className="page-title text-balance">{title}</h1>
        {lead && <p className="mt-2 max-w-2xl leading-relaxed text-muted">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** A titled region of a working screen, with an optional count and actions on the same line. */
export function Section({
  id,
  title,
  lead,
  count,
  actions,
  children,
  className,
}: {
  id: string;
  title: string;
  lead?: string;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-strong pb-3">
        <div className="min-w-0">
          <h2 id={id} className="section-title flex items-baseline gap-2.5">
            {title}
            {count !== undefined && <span className="num text-sm font-semibold text-muted">{count}</span>}
          </h2>
          {lead && <p className="mt-1 text-sm text-muted">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Nothing to show yet. Says why, and offers the next step when there is one. */
export function EmptyState({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      <svg aria-hidden viewBox="0 0 120 40" className="mx-auto mb-4 h-8 w-24 text-gold">
        <path d="M0 40V28h10v-8h10v-8h10V4h20v8h10v8h10v8h10v12z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M60 14l7 13H53z" fill="currentColor" opacity="0.5" />
      </svg>
      <p className="subsection-title">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{body}</p>}
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}

/** A figure that matters, with its label. Only ever fed real counts. */
export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="kpi-value mt-1">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

const TONES = {
  neutral: { box: 'bg-surface-2 text-foreground', dot: 'bg-muted', shape: 'rounded-full' },
  active: { box: 'bg-success-surface text-success', dot: 'bg-success', shape: 'rounded-full' },
  warning: { box: 'bg-warning-surface text-warning', dot: 'bg-warning', shape: 'rotate-45 rounded-[1px]' },
  danger: { box: 'bg-error-surface text-error', dot: 'bg-error', shape: 'rounded-[1px]' },
  info: { box: 'bg-info-surface text-info', dot: 'bg-info', shape: 'rounded-full' },
} as const;

/** A status. Tone is carried by colour and by the marker's shape, so it never depends on colour alone. */
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  const s = TONES[tone];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-0.5 text-xs font-semibold whitespace-nowrap', s.box)}>
      <span aria-hidden className={clsx('size-1.5 shrink-0', s.dot, s.shape)} />
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof TONES {
  if (['rejected', 'withdrawn', 'expired', 'cancelled', 'no_show'].includes(status)) return 'danger';
  if (['hired', 'evaluated', 'shortlisted', 'accepted', 'completed', 'submitted'].includes(status)) return 'active';
  if (['assessment_invited', 'invited', 'reschedule_requested'].includes(status)) return 'warning';
  if (['under_review', 'assessment_in_progress', 'in_progress', 'scheduled', 'assessment_submitted'].includes(status)) return 'info';
  return 'neutral';
}

/** A slim bar for completion. `label` is read out; the bar itself is decoration. */
export function Meter({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={className}>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/**
 * Where you are in a guided flow. Steps before the current one are links back; the current one is marked; later ones
 * are shown but not reachable yet, so nobody skips a required step by accident.
 */
export function Stepper({ label, steps, current, hrefFor, orientation = 'horizontal' }: {
  label: string; steps: string[]; current: number; hrefFor?: (index: number) => string; orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <ol aria-label={label} className={clsx(orientation === 'vertical' ? 'relative space-y-1' : 'flex gap-1 overflow-x-auto pb-1')}>
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'next';
        const marker = (
          <span aria-hidden className={clsx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', state === 'done' ? 'bg-primary text-primary-foreground' : state === 'current' ? 'bg-[var(--button)] text-[var(--button-foreground)] ring-4 ring-gold/25' : 'border border-border-strong text-muted')}>
            {state === 'done' ? '✓' : i + 1}
          </span>
        );
        const text = <span className={clsx('text-sm leading-snug', state === 'current' ? 'font-semibold' : state === 'done' ? '' : 'text-muted')}>{step}</span>;
        const inner = <span className={clsx('flex items-center gap-2.5', orientation === 'horizontal' && 'pe-3')}>{marker}{text}</span>;
        return (
          <li key={step} aria-current={state === 'current' ? 'step' : undefined} className="shrink-0">
            {state === 'done' && hrefFor
              ? <a href={hrefFor(i)} className="block rounded-[var(--radius-control)] p-1.5 hover:bg-surface-2/70">{inner}</a>
              : <span className="block p-1.5">{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** A vertical history: each step a diamond on a line, the latest one in gold. */
export function Timeline({ label, items }: { label: string; items: { key: string; title: React.ReactNode; when: React.ReactNode; detail?: React.ReactNode }[] }) {
  return (
    <ol aria-label={label} className="relative">
      <span aria-hidden className="absolute start-[0.3rem] top-2 bottom-2 w-px bg-border-strong" />
      {items.map((item, i) => {
        const latest = i === items.length - 1;
        return (
          <li key={item.key} className="relative pb-5 ps-7 last:pb-0">
            <span aria-hidden className={clsx('absolute start-0 top-1.5 size-2.5 rotate-45', latest ? 'bg-gold ring-4 ring-gold/20' : 'bg-primary')} />
            <p className={clsx('text-sm', latest ? 'font-semibold' : 'font-medium')}>{item.title}</p>
            <p className="mt-0.5 text-xs text-muted">{item.when}</p>
            {item.detail && <div className="mt-1 text-sm">{item.detail}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Loading placeholders that keep the page's shape, so nothing jumps when data arrives. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx('skeleton block', className)} />;
}
