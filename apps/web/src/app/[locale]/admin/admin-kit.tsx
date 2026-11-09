import clsx from 'clsx';

/** A plain data table for the admin screens. Scrolls sideways on small screens instead of squeezing columns. */
export function DataTable({ head, children, caption }: { head: React.ReactNode[]; children: React.ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-border bg-surface">
      <table className="table-x min-w-[40rem] text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, className, ltr }: { children?: React.ReactNode; className?: string; ltr?: boolean }) {
  return <td className={clsx('align-top', className)} dir={ltr ? 'ltr' : undefined}>{children ?? '—'}</td>;
}

export function Stat({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className="kpi-value mt-2">{value}</p>
    </>
  );
  return href ? <a href={href} className="card group relative block overflow-hidden transition-colors hover:border-border-strong"><span aria-hidden className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100 rtl:origin-right" />{body}</a> : <div className="card">{body}</div>;
}
