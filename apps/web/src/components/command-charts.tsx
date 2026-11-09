'use client';

import clsx from 'clsx';
import { motion } from 'motion/react';
import { useLocale } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { STAGE_COLORS } from './workspace-kit';

/**
 * The command center's charts. Hand-drawn SVG, interactive (hover and keyboard focus), mirrored for RTL, with every
 * value also in a visually hidden table. They receive real counts already scoped to one organization; nothing here
 * estimates, extrapolates or compares across incompatible data.
 */

const fmt = (locale: string) => new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en');
const EASE = [0.22, 1, 0.36, 1] as const;


/* ---------------------------------------------------------------- Funnel */

export type FunnelStage = { key: string; label: string; reached: number; current: number; href: string };

/**
 * How far applications got. "Reached" counts every open or hired application at or beyond a stage, which the current
 * status proves; closed applications are left out because their last stage isn't recorded in this list.
 */
export function RecruitmentFunnel({ stages, labels }: { stages: FunnelStage[]; labels: { reached: string; here: string; caption: string; empty: string } }) {
  const locale = useLocale();
  const rtl = locale === 'ar';
  const n = fmt(locale).format;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(1, ...stages.map((s) => s.reached));
  if (stages.every((s) => s.reached === 0)) {
    return <FunnelEmpty text={labels.empty} />;
  }
  const W = 1000, H = 300, top = 92, band = 170, minBand = 10;
  const step = W / stages.length;
  const x = (i: number) => (rtl ? W - (i * step + step / 2) : i * step + step / 2);
  const h = (v: number) => minBand + (v / max) * (band - minBand);
  const mid = top + band / 2;
  // Ribbon outline: the top edge left to right, then the bottom edge back, with smooth curves between stages.
  const edge = (sign: 1 | -1) => stages.map((s, i) => ({ x: x(i), y: mid + sign * h(s.reached) / 2 }));
  const curve = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `C${(pts[i - 1].x + p.x) / 2} ${pts[i - 1].y} ${(pts[i - 1].x + p.x) / 2} ${p.y} ${p.x} ${p.y}`)).join(' ');
  const topPts = edge(-1);
  const botPts = edge(1).reverse();
  const startCap = rtl ? W : 0, endCap = rtl ? 0 : W;
  const path = `${curve([{ x: startCap, y: topPts[0].y }, ...topPts, { x: endCap, y: topPts.at(-1)!.y }])} L${endCap} ${botPts[0].y} ${curve([{ x: endCap, y: botPts[0].y }, ...botPts, { x: startCap, y: botPts.at(-1)!.y }]).replace(/^M[^C]+/, '')} Z`;

  return (
    <figure className="relative">
      <div className="sr-only"><table>
        <caption>{labels.caption}</caption>
        <thead><tr><th>{labels.caption}</th><th>{labels.reached}</th><th>{labels.here.replace('{count}', '').trim()}</th></tr></thead>
        <tbody>{stages.map((s) => <tr key={s.key}><th scope="row">{s.label}</th><td>{n(s.reached)}</td><td>{n(s.current)}</td></tr>)}</tbody>
      </table></div>

      {/* Wide screens: a ribbon funnel across the stages. */}
      <div aria-hidden className="relative hidden md:block">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible">
          <defs>
            <linearGradient id={`${id}-g`} x1={rtl ? '1' : '0'} x2={rtl ? '0' : '1'} y1="0" y2="0">
              {stages.map((s, i) => <stop key={s.key} offset={`${(i + 0.5) / stages.length}`} stopColor={STAGE_COLORS[i] ?? STAGE_COLORS.at(-1)} />)}
            </linearGradient>
          </defs>
          {stages.map((s, i) => <line key={s.key} x1={x(i)} x2={x(i)} y1={top - 8} y2={top + band + 8} stroke="var(--border-strong)" strokeDasharray="2 4" />)}
          <motion.path
            d={path}
            fill={`url(#${id}-g)`}
            initial={{ opacity: 0, scaleY: 0.2 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 1, ease: EASE }}
            style={{ transformOrigin: `50% ${mid}px` }}
          />
          {stages.map((s, i) => (
            <rect key={s.key} x={x(i) - step / 2} y={0} width={step} height={H} fill="var(--foreground)" opacity={hover === null || hover === i ? 0 : 0.07} className="transition-opacity" />
          ))}
        </svg>
        <ol className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => (
            <li key={s.key} className="relative">
              <a
                href={s.href}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={-1}
                className="absolute inset-0 flex flex-col items-center"
              >
                <span className="mt-1 text-center text-xs font-semibold tracking-wide text-muted">{s.label}</span>
                <span className="num font-display text-3xl leading-tight font-bold">{n(s.reached)}</span>
                <span className={clsx('mt-auto mb-1 rounded-[3px] px-2 py-0.5 text-[0.6875rem] font-semibold transition-colors', hover === i ? 'bg-[var(--button)] text-[var(--button-foreground)]' : 'text-muted')}>
                  {labels.here.replace('{count}', n(s.current))}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* Phones: the same stages as a stepped column. */}
      <ol aria-hidden className="space-y-2 md:hidden">
        {stages.map((s, i) => (
          <li key={s.key}>
            <a href={s.href} className="block">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">{s.label}</span>
                <span className="num"><span className="font-display text-lg font-bold">{n(s.reached)}</span> <span className="text-xs text-muted">{labels.here.replace('{count}', n(s.current))}</span></span>
              </span>
              <span className="mt-1 flex justify-center">
                <span className="block h-7 rounded-[3px]" style={{ width: `${Math.max(6, (s.reached / max) * 100)}%`, background: STAGE_COLORS[i] }} />
              </span>
            </a>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function FunnelEmpty({ text }: { text: string }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-dashed border-border-strong px-6 py-12 text-center">
      <svg aria-hidden viewBox="0 0 600 120" className="mx-auto h-20 w-full max-w-xl opacity-60">
        <path d="M0 10 C150 10 150 30 300 30 C450 30 450 50 600 50 L600 70 C450 70 450 90 300 90 C150 90 150 110 0 110 Z" fill="none" stroke="var(--border-strong)" strokeWidth="2" strokeDasharray="6 6" />
      </svg>
      <p className="mt-4 text-muted">{text}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Trend */

export type TrendPoint = { key: string; label: string; detail: string; value: number };

/** Applications over time: an area chart with a crosshair that follows the pointer or the keyboard. */
export function TrendChart({ points, caption, unit, empty }: { points: TrendPoint[]; caption: string; unit: string; empty: string }) {
  const locale = useLocale();
  const rtl = locale === 'ar';
  const n = fmt(locale).format;
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  // Drawn at the container's real width, so labels stay legible at every size instead of shrinking with a viewBox.
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.every((p) => p.value === 0)) return <FunnelEmpty text={empty} />;
  const W = Math.max(280, width), H = width < 480 ? 220 : 280, padX = 36, padTop = 20, padBottom = 34;
  const max = Math.max(1, ...points.map((p) => p.value));
  const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const span = points.length > 1 ? (W - padX * 2) / (points.length - 1) : 0;
  const xi = (i: number) => (rtl ? W - padX - i * span : padX + i * span);
  const yv = (v: number) => padTop + (1 - v / nice) * (H - padTop - padBottom);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xi(i)} ${yv(p.value)}`).join(' ');
  const area = `${line} L${xi(points.length - 1)} ${H - padBottom} L${xi(0)} ${H - padBottom} Z`;
  const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice];
  const every = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor((W - padX * 2) / 64))));

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(rtl ? (W - padX - vx) / span : (vx - padX) / span);
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <figure>
      <div className="sr-only"><table><caption>{caption}</caption><tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.detail}</th><td>{n(p.value)}</td></tr>)}</tbody></table></div>
      <div
        ref={box}
        aria-hidden
        className="relative touch-pan-y"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }}>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--brand-green)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--brand-green)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={padX} x2={W - padX} y1={yv(tk)} y2={yv(tk)} stroke="var(--border)" />
              <text x={rtl ? W - padX + 10 : padX - 10} y={yv(tk) + 4} textAnchor={rtl ? 'start' : 'end'} className="fill-[var(--muted)] text-[12px]">{n(tk)}</text>
            </g>
          ))}
          <motion.path d={area} fill={`url(#${id}-a)`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9 }} />
          <motion.path d={line} fill="none" stroke="var(--brand-green)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: EASE }} />
          {points.map((p, i) => (
            <g key={p.key}>
              {i % every === 0 && <text x={xi(i)} y={H - 10} textAnchor="middle" className="fill-[var(--muted)] text-[12px]">{p.label}</text>}
              <circle cx={xi(i)} cy={yv(p.value)} r={active === i ? 7 : 3.5} fill={active === i ? 'var(--brand-gold)' : 'var(--brand-green)'} stroke="var(--surface)" strokeWidth="2" className="transition-all" />
            </g>
          ))}
          {active !== null && <line x1={xi(active)} x2={xi(active)} y1={padTop} y2={H - padBottom} stroke="var(--foreground)" strokeOpacity="0.25" strokeDasharray="3 4" />}
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[var(--radius-control)] bg-[var(--button)] px-3 py-2 text-[var(--button-foreground)] shadow-[var(--shadow)]"
            style={{ left: `${(xi(active) / W) * 100}%` }}
          >
            <span className="block text-xs opacity-80">{points[active].detail}</span>
            <span className="num block font-display text-lg font-bold">{n(points[active].value)} <span className="text-xs font-normal">{unit}</span></span>
          </div>
        )}
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------- Ranked jobs */

export type JobRank = { key: string; label: string; status: string; href: string; total: number; segments: { key: string; label: string; value: number }[] };

/** Jobs ranked by applications, each bar split by where those applicants are now. */
export function JobRanking({ jobs, legend, empty }: { jobs: JobRank[]; legend: { key: string; label: string }[]; empty: string }) {
  const locale = useLocale();
  const n = fmt(locale).format;
  const [tip, setTip] = useState<{ job: string; seg: string } | null>(null);
  const ranked = [...jobs].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...ranked.map((j) => j.total));
  if (ranked.every((j) => j.total === 0)) return <p className="rounded-[var(--radius-panel)] border border-dashed border-border-strong px-4 py-10 text-center text-muted">{empty}</p>;
  return (
    <div>
      <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {legend.map((l, i) => <li key={l.key} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: STAGE_COLORS[i] }} />{l.label}</li>)}
      </ul>
      <ol className="space-y-4">
        {ranked.map((j, rank) => (
          <li key={j.key} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3">
            <span className="num pt-0.5 font-display text-xl font-bold text-gold-text">{n(rank + 1)}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <a href={j.href} className="truncate font-semibold hover:text-primary">{j.label}</a>
                <span className="num shrink-0 font-display text-lg font-bold">{n(j.total)}</span>
              </div>
              <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface-2" style={{ width: `${Math.max(4, (j.total / max) * 100)}%` }}>
                {j.segments.map((s, i) => s.value > 0 && (
                  <motion.span
                    key={s.key}
                    title={`${s.label}: ${n(s.value)}`}
                    onMouseEnter={() => setTip({ job: j.key, seg: s.key })}
                    onMouseLeave={() => setTip(null)}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.7, delay: 0.05 * rank, ease: EASE }}
                    className={clsx('h-full origin-left rtl:origin-right', tip && tip.job === j.key && tip.seg !== s.key && 'opacity-40')}
                    style={{ width: `${(s.value / j.total) * 100}%`, background: STAGE_COLORS[i] }}
                  />
                ))}
              </div>
              <p className="mt-1.5 h-4 text-xs text-muted">
                {tip?.job === j.key ? (() => { const s = j.segments.find((x) => x.key === tip.seg)!; return `${s.label}: ${n(s.value)}`; })() : j.status}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- Sparkline */

/** A small line for the headline figure, from the same weekly counts as the trend chart. */
export function Sparkline({ values }: { values: number[] }) {
  const locale = useLocale();
  const rtl = locale === 'ar';
  const W = 160, H = 44;
  const max = Math.max(1, ...values);
  const span = values.length > 1 ? W / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${rtl ? W - i * span : i * span},${H - 4 - (v / max) * (H - 8)}`);
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} className="h-11 w-40">
      <motion.polyline points={pts.join(' ')} fill="none" stroke="var(--brand-gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: EASE }} />
    </svg>
  );
}
