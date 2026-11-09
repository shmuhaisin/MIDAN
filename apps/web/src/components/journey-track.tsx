import clsx from 'clsx';

/** The application stages a candidate moves through, in order, as the database names them. */
export const APPLICATION_STAGES = ['submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated'] as const;

/** A compact track of an application's stage: diamonds on a line, reached ones in green, the current one in gold. */
export function StageTrack({ status, label, className }: { status: string; label: string; className?: string }) {
  const reached = ['shortlisted', 'hired'].includes(status) ? APPLICATION_STAGES.length : APPLICATION_STAGES.indexOf(status as (typeof APPLICATION_STAGES)[number]) + 1;
  return (
    <span role="img" aria-label={label} className={clsx('relative flex w-36 items-center justify-between', className)}>
      <span aria-hidden className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-border-strong" />
      <span aria-hidden className="absolute start-1 top-1/2 h-px -translate-y-1/2 bg-primary" style={{ width: `${Math.max(0, (reached - 1) / (APPLICATION_STAGES.length - 1)) * 96}%` }} />
      {APPLICATION_STAGES.map((step, i) => (
        <span key={step} aria-hidden className={clsx('relative size-2 rotate-45', i < reached - 1 ? 'bg-primary' : i === reached - 1 ? 'size-2.5 bg-gold' : 'border border-border-strong bg-background')} />
      ))}
    </span>
  );
}

/** The candidate's whole path, drawn like the road on the landing page. `deep` draws it for a deep green surface. */
export function JourneyRoad({ label, steps, done, deep = false }: { label: string; steps: string[]; done: boolean[]; deep?: boolean }) {
  const current = done.indexOf(false);
  const half = `${50 / steps.length}%`;
  return (
    <ol aria-label={label} className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className={clsx('absolute top-[0.55rem] h-px', deep ? 'bg-mint/25' : 'bg-border-strong')} style={{ insetInlineStart: half, insetInlineEnd: half }} />
      {steps.map((step, i) => (
        <li key={step} aria-current={i === current ? 'step' : undefined} className="relative flex flex-col items-center text-center">
          <span
            aria-hidden
            className={clsx(
              'relative z-10 size-3 rotate-45 transition-colors',
              done[i] ? (deep ? 'bg-mint' : 'bg-primary') : i === current ? 'scale-125 bg-gold ring-4 ring-gold/25' : deep ? 'border border-mint/45 bg-deep-2' : 'border border-border-strong bg-background',
            )}
          />
          <span className={clsx('mt-3 hidden px-1 text-xs leading-snug sm:block', i === current ? 'font-semibold' : done[i] ? (deep ? 'text-ivory/85' : 'text-foreground/80') : deep ? 'text-deep-muted' : 'text-muted')}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
