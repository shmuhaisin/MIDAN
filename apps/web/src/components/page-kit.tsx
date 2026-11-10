import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { number } from '@/lib/format';
import type { HumaidanVariant } from '@/lib/humaidan';
import { Humaidan, Logo, Parapet } from './brand';
import { Reveal } from './interactive';

type Art = { kind: 'humaidan'; outfit?: HumaidanVariant } | { kind: 'logo' } | { kind: 'steps'; steps: string[] } | { kind: 'none' };

/**
 * The public pages' opening: an editorial title on the start side, and an architectural panel on the end side that
 * differs by page, so no two pages open the same way.
 */
export function PageHero({ ns, art = { kind: 'none' }, children }: { ns: string; art?: Art; children?: React.ReactNode }) {
  const t = useTranslations(ns);
  const locale = useLocale();
  const compact = art.kind === 'none';
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_90%_at_100%_0%,color-mix(in_srgb,var(--brand-mint)_22%,transparent),transparent_70%)] rtl:bg-[radial-gradient(70%_90%_at_0%_0%,color-mix(in_srgb,var(--brand-mint)_22%,transparent),transparent_70%)]" />
      <div className={clsx('container-page relative grid items-end gap-10 lg:grid-cols-12', compact ? 'py-14 lg:py-20' : 'pt-14 lg:pt-20')}>
        <div className={clsx(compact ? 'lg:col-span-9' : 'pb-14 lg:col-span-7 lg:pb-20')}>
          <div className="rise">
            <p className="flex items-center gap-3 text-sm font-semibold text-gold-text">
              <span aria-hidden className="h-px w-10 bg-gold" />
              {t('eyebrow')}
            </p>
            <h1 className="display-lg mt-5 text-balance">{t('title')}</h1>
            {t.has('lead') && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{t('lead')}</p>}
            {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
          </div>
        </div>
        {art.kind === 'humaidan' && (
          <div aria-hidden className="relative mx-auto w-full max-w-sm lg:col-span-5 lg:me-0 lg:ms-auto">
            <div className="najdi-arch relative aspect-[5/6] overflow-hidden bg-[linear-gradient(180deg,var(--brand-deep),color-mix(in_srgb,var(--brand-deep)_75%,var(--brand-green)))]">
              <span className="absolute inset-x-[8%] bottom-0 h-1 bg-brand-gold" />
            </div>
            <div className="absolute inset-x-0 bottom-0 mx-auto w-[72%]">
              <Humaidan outfit={art.outfit} sizes="(min-width: 1024px) 26vw, 60vw" priority idle />
            </div>
          </div>
        )}
        {art.kind === 'logo' && (
          <div aria-hidden className="on-deep deep-grain relative mb-14 overflow-hidden rounded-[var(--radius-panel)] bg-deep p-8 lg:col-span-5 lg:mb-20">
            <span className="relative block p-2"><Logo decorative className="h-auto w-full" sizes="420px" /></span>
            <span className="relative mt-5 block h-px bg-brand-gold/60" />
          </div>
        )}
        {art.kind === 'steps' && (
          <ol aria-hidden className="relative mb-14 hidden border-s border-border-strong lg:col-span-5 lg:mb-20 lg:block">
            {art.steps.map((s, i) => (
              <li key={s} className="relative py-2.5 ps-6">
                <span className="absolute -start-[5px] top-1/2 size-2.5 -translate-y-1/2 rotate-45 bg-gold" />
                <span className="num me-3 text-sm font-semibold text-gold-text">{number(locale, i + 1)}</span>
                <span className="font-display text-lg font-semibold">{s}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Parapet className="h-5 text-surface-2" />
    </section>
  );
}

/** Numbered points in a two-column editorial grid. */
export function PointList({ points }: { points: { title: string; body: string }[] }) {
  const locale = useLocale();
  return (
    <ol className="grid border-t border-border-strong md:grid-cols-2">
      {points.map((p, i) => (
        <li key={p.title} className="border-b border-border md:odd:border-e md:odd:pe-12 md:even:ps-12">
          <Reveal delay={(i % 2) * 0.06} className="flex gap-5 py-10">
            <span className="num pt-1 text-sm font-semibold text-gold-text">{String(i + 1).padStart(2, '0').replace(/\d/g, (d) => number(locale, Number(d)))}</span>
            <span>
              <h2 className="font-display text-2xl font-bold">{p.title}</h2>
              <p className="mt-3 text-lg leading-relaxed text-muted">{p.body}</p>
            </span>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}

/** A calm band that closes a page with one clear next step: a warm surface, a gold rule, the action. */
export function ClosingBand({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border bg-surface">
      <div className="container-page grid gap-8 py-16 lg:grid-cols-12 lg:items-end lg:py-20">
        <div className="lg:col-span-8">
          <span aria-hidden className="mb-6 block h-0.5 w-16 bg-gold" />
          <h2 className="display-lg text-balance">{title}</h2>
          {body && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{body}</p>}
        </div>
        <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">{children}</div>
      </div>
    </section>
  );
}
