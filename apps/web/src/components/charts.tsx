import clsx from 'clsx';

/**
 * MIDAN's charts: plain SVG and HTML, drawn from the theme tokens, mirrored for RTL by the layout itself.
 * Every chart carries its numbers as an accessible table (visually hidden), and says plainly when there is nothing to show.
 * They only ever receive real, already-scoped data; they never compute rates the data can't support.
 */

export type Datum = { key: string; label: string; value: number; href?: string };

function Empty({ text }: { text: string }) {
  return <p className="rounded-[var(--radius-control)] border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted">{text}</p>;
}

function DataTable({ caption, rows, format }: { caption: string; rows: Datum[]; format: (n: number) => string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.label}</th><td>{format(r.value)}</td></tr>)}</tbody>
    </table>
  );
}

/** Horizontal bars, longest first by default: "which job attracts the most applications". */
export function BarList({ caption, data, format, empty, tone = 'primary', sort = true }: {
  caption: string; data: Datum[]; format: (n: number) => string; empty: string; tone?: 'primary' | 'gold'; sort?: boolean;
}) {
  const rows = sort ? [...data].sort((a, b) => b.value - a.value) : data;
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) return <Empty text={empty} />;
  return (
    <figure>
      <DataTable caption={caption} rows={rows} format={format} />
      <ul aria-hidden className="space-y-3">
        {rows.map((r) => {
          const bar = (
            <span className="block">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{r.label}</span>
                <span className="num shrink-0 font-semibold">{format(r.value)}</span>
              </span>
              <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-2">
                <span className={clsx('block h-full rounded-full', tone === 'gold' ? 'bg-gold' : 'bg-[var(--org-primary,var(--primary))]')} style={{ width: `${(r.value / max) * 100}%` }} />
              </span>
            </span>
          );
          return <li key={r.key}>{r.href ? <a href={r.href} className="block rounded-[var(--radius-control)] hover:bg-surface-2/60">{bar}</a> : bar}</li>;
        })}
      </ul>
    </figure>
  );
}

/** Columns over time: "applications per week". Labels are already formatted for the locale. */
export function ColumnChart({ caption, data, format, empty }: { caption: string; data: Datum[]; format: (n: number) => string; empty: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.every((d) => d.value === 0)) return <Empty text={empty} />;
  const ticks = [max, Math.round(max / 2), 0];
  return (
    <figure>
      <DataTable caption={caption} rows={data} format={format} />
      <div aria-hidden className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
        <div className="flex h-40 flex-col justify-between text-end text-[0.6875rem] text-muted">
          {ticks.map((tk, i) => <span key={i} className="num leading-none">{format(tk)}</span>)}
        </div>
        <div className="relative h-40">
          {[0, 0.5, 1].map((p) => <span key={p} className="absolute inset-x-0 h-px bg-border" style={{ top: `${p * 100}%` }} />)}
          <div className="relative flex h-full items-end gap-2">
            {data.map((d) => (
              <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${format(d.value)}`}>
                <span className="pointer-events-none absolute -top-6 start-1/2 hidden -translate-x-1/2 rounded-[3px] bg-[var(--button)] px-1.5 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-[var(--button-foreground)] group-hover:block rtl:translate-x-1/2">{format(d.value)}</span>
                <span className="block rounded-t-[3px] bg-[var(--org-primary,var(--primary))] transition-[height] duration-700" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0 }} />
              </div>
            ))}
          </div>
        </div>
        <span />
        <div className="flex gap-2">
          {/* Dense series label every other column; the tooltip and the table carry every value. */}
          {data.map((d, i) => <span key={d.key} className="num flex-1 truncate text-center text-[0.6875rem] text-muted">{data.length <= 6 || i % 2 === data.length % 2 ? d.label : ''}</span>)}
        </div>
      </div>
    </figure>
  );
}

/**
 * Where applicants are now, stage by stage. It shows current positions, not conversion: the list of applications
 * doesn't carry each one's history, so a rate between stages would be invented.
 */
export function StageStrip({ caption, data, format, empty }: { caption: string; data: Datum[]; format: (n: number) => string; empty: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty text={empty} />;
  return (
    <figure>
      <DataTable caption={caption} rows={data} format={format} />
      <div aria-hidden className="flex h-3 overflow-hidden rounded-full bg-surface-2">
        {data.map((d, i) => d.value > 0 && (
          <span key={d.key} className="h-full" style={{ width: `${(d.value / total) * 100}%`, background: `color-mix(in srgb, var(--org-primary, var(--brand-green)) ${100 - i * 13}%, var(--brand-mint))` }} />
        ))}
      </div>
      <ol aria-hidden className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.map((d, i) => {
          const body = (
            <>
              <span className="flex items-center gap-2 text-xs text-muted">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: `color-mix(in srgb, var(--org-primary, var(--brand-green)) ${100 - i * 13}%, var(--brand-mint))` }} />
                {d.label}
              </span>
              <span className="num mt-1 block font-display text-2xl font-bold">{format(d.value)}</span>
            </>
          );
          return <li key={d.key}>{d.href ? <a href={d.href} className="block rounded-[var(--radius-control)] hover:text-primary">{body}</a> : body}</li>;
        })}
      </ol>
    </figure>
  );
}

/** A figure with its label, linking to where it can be acted on. Only real counts. */
export function Kpi({ label, value, hint, href, icon }: { label: string; value: string; hint?: string; href?: string; icon?: React.ReactNode }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm text-muted">{icon}{label}</span>
      <span className="kpi-value mt-2 block">{value}</span>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </>
  );
  return href
    ? <a href={href} className="group relative block bg-surface p-5 transition-colors hover:bg-surface-2/50"><span aria-hidden className="absolute inset-x-5 top-0 h-0.5 origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100 rtl:origin-right" />{body}</a>
    : <div className="bg-surface p-5">{body}</div>;
}
