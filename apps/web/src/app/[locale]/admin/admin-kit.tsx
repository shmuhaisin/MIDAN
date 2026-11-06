import clsx from 'clsx';

/** A plain data table for the admin screens. Scrolls sideways on small screens instead of squeezing columns. */
export function DataTable({ head, children, caption }: { head: React.ReactNode[]; children: React.ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[40rem] text-start text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, className, ltr }: { children?: React.ReactNode; className?: string; ltr?: boolean }) {
  return <td className={clsx('px-3 py-2 align-top', className)} dir={ltr ? 'ltr' : undefined}>{children ?? '—'}</td>;
}

export function Stat({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
    </>
  );
  return href ? <a href={href} className="card block transition-colors hover:border-primary">{body}</a> : <div className="card">{body}</div>;
}
