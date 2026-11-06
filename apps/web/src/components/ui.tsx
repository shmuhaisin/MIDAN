import clsx from 'clsx';

export function PageHeader({ title, lead, children, className }: { title: string; lead?: string; children?: React.ReactNode; className?: string }) {
  return (
    <header className={clsx('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 max-w-2xl">
        <h1 className="page-title">{title}</h1>
        {lead && <p className="mt-1.5 text-muted">{lead}</p>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="card text-center">
      <p className="subsection-title">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xl text-sm text-muted">{body}</p>}
      {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-surface-2 text-foreground',
  active: 'bg-accent text-accent-foreground',
  warning: 'bg-surface-2 text-foreground ring-1 ring-gold',
  danger: 'bg-surface-2 text-error',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone])}>{children}</span>;
}

export function statusTone(status: string): keyof typeof TONES {
  if (['rejected', 'withdrawn', 'expired', 'cancelled', 'no_show'].includes(status)) return 'danger';
  if (['hired', 'evaluated', 'shortlisted', 'accepted', 'completed', 'submitted'].includes(status)) return 'active';
  if (['assessment_invited', 'invited', 'reschedule_requested'].includes(status)) return 'warning';
  return 'neutral';
}
