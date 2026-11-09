import clsx from 'clsx';
import type { HumaidanVariant } from '@/lib/humaidan';
import { Humaidan } from './brand';

/**
 * Humaidan as a guide: a short, optional word at the moment it helps (a first step, an empty list, what to submit).
 * He never blocks a workflow and never pretends to converse. Candidate-facing only; employers get a formal product.
 */
export function Guide({ title, children, outfit, action, className }: {
  title: string; children?: React.ReactNode; outfit?: HumaidanVariant; action?: React.ReactNode; className?: string;
}) {
  return (
    <aside className={clsx('relative flex items-end gap-4 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-[linear-gradient(135deg,var(--surface),color-mix(in_srgb,var(--brand-mint)_18%,var(--surface)))] p-4 ps-2 sm:gap-5', className)}>
      <div aria-hidden className="w-16 shrink-0 self-end sm:w-20"><Humaidan outfit={outfit} sizes="80px" /></div>
      <div className="min-w-0 flex-1 pb-1">
        <p className="font-display font-bold leading-snug">{title}</p>
        {children && <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </aside>
  );
}
