'use client';

import clsx from 'clsx';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from '@/i18n/navigation';
import { Arrow, Humaidan, Logo } from '../brand';
import { PREVIEWS } from './previews';
import type { World } from './world';

const EASE = [0.22, 1, 0.36, 1] as const;

import { holdCentre, LAST, sceneVisibility, toPosition } from './journey-model';

type Stage = { title: string; short: string; body: string };

const reducedQuery = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const q = window.matchMedia(reducedQuery);
  q.addEventListener('change', cb);
  return () => q.removeEventListener('change', cb);
};

/* ---------- The copy ---------- */

function HeroCopy({ animate = true }: { animate?: boolean }) {
  const t = useTranslations('journey');
  const line = (text: string, i: number, accent?: boolean) => (
    <span className="block overflow-hidden pb-[0.1em]">
      <motion.span
        data-reveal
        className={clsx('block', accent && 'text-primary')}
        initial={animate ? { y: '105%' } : false}
        animate={{ y: 0 }}
        transition={{ duration: 1, delay: 0.35 + i * 0.15, ease: EASE }}
      >
        {text}
      </motion.span>
    </span>
  );
  const fade = (delay: number) => (animate ? { 'data-reveal': true, initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay, ease: EASE } } : {});
  return (
    <>
      <motion.p {...fade(0.15)} className="flex items-center gap-3 text-sm font-semibold text-gold-text">
        <span className="num">01</span>
        <span aria-hidden className="h-px w-10 bg-gold" />
        {t('eyebrow')}
      </motion.p>
      <h1 className="display-xl mt-4 sm:mt-6">
        {line(t('line1'), 0)}
        {line(t('line2'), 1, true)}
      </h1>
      <motion.span {...fade(1.05)} aria-hidden className="mt-2 block h-[3px] w-24 bg-gold" />
      <motion.p {...fade(0.85)} className="mt-5 max-w-lg text-base leading-relaxed text-foreground/80 sm:mt-6 sm:text-lg">
        {t('lead')}
      </motion.p>
      <motion.div {...fade(1)} className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
        <Link href="/register?as=candidate" className="btn btn-primary group px-3 sm:min-h-13 sm:px-7 sm:text-base">
          {t('ctaCandidate')}
          <Arrow className="hidden transition-transform duration-300 group-hover:translate-x-1 sm:block rtl:group-hover:-translate-x-1" />
        </Link>
        <Link href="/register?as=organization" className="btn btn-secondary bg-background/75 px-3 backdrop-blur sm:min-h-13 sm:px-7 sm:text-base">
          {t('ctaEmployer')}
        </Link>
      </motion.div>
      {animate && (
        <motion.p {...fade(1.4)} aria-hidden className="mt-10 hidden items-center gap-3 text-xs font-medium text-muted lg:flex">
          <span className="relative h-9 w-px overflow-hidden bg-foreground/20"><span className="journey-cue absolute inset-x-0 top-0 h-3 bg-gold" /></span>
          {t('scroll')}
        </motion.p>
      )}
    </>
  );
}

function SceneCopy({ index, stage }: { index: number; stage: Stage }) {
  const t = useTranslations('journey');
  return (
    <>
      <p className="flex items-center gap-3 text-sm font-semibold text-gold-text">
        <span className="num">{String(index + 1).padStart(2, '0')}</span>
        <span aria-hidden className="h-px w-10 bg-gold" />
        {t('destination')}
      </p>
      <h2 className="display-lg mt-3 text-balance sm:mt-4">{index === LAST ? t('finalTitle') : stage.title}</h2>
      <p className="mt-3 max-w-md leading-relaxed text-foreground/80 sm:mt-4 sm:text-lg">{index === LAST ? t('finalLead') : stage.body}</p>
      {index === LAST && (
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
          <Link href="/register?as=candidate" className="btn btn-primary px-3 sm:min-h-13 sm:px-7 sm:text-base">{t('ctaCandidate')}</Link>
          <Link href="/register?as=organization" className="btn btn-secondary bg-background/75 px-3 backdrop-blur sm:min-h-13 sm:px-7 sm:text-base">{t('ctaEmployer')}</Link>
        </div>
      )}
    </>
  );
}

/* ---------- The 3D world, loaded after the copy ---------- */

type WorldState = 'loading' | 'ready' | 'unavailable';

function useWorld(canvas: React.RefObject<HTMLCanvasElement | null>, frame: React.RefObject<HTMLElement | null>, onReady: (w: World) => void) {
  const locale = useLocale();
  const [state, setState] = useState<WorldState>('loading');
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });

  useEffect(() => {
    let disposed = false;
    let world: World | null = null;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    const el = canvas.current;
    const box = frame.current;
    if (!el || !box) return;
    const dark = () => document.documentElement.dataset.theme === 'dark';
    const quality = window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high';
    import('./world')
      .then(({ createWorld }) => {
        if (disposed) return;
        world = createWorld(el, { rtl: locale === 'ar', dark: dark(), quality, humaidanUrl: '/assets/humaidan/01_Humaidan_Original.png' });
        const w = world;
        const size = () => {
          w.resize(box.clientWidth, box.clientHeight);
          w.render();
        };
        size();
        observer = new ResizeObserver(size);
        observer.observe(box);
        themeObserver = new MutationObserver(() => {
          w.setTheme(dark());
          w.render();
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        ready.current(w);
        w.render();
        setState('ready');
      })
      .catch(() => !disposed && setState('unavailable'));
    return () => {
      disposed = true;
      observer?.disconnect();
      themeObserver?.disconnect();
      world?.dispose();
    };
  }, [canvas, frame, locale]);

  return state;
}

/** Before the world arrives, or where WebGL isn't available: the sky, the logo and Humaidan. */
function Backdrop({ state }: { state: WorldState }) {
  return (
    <div aria-hidden className={clsx('absolute inset-0 transition-opacity duration-1000', state === 'ready' ? 'opacity-0' : 'opacity-100')}>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--sky-top)_0%,var(--sky-bottom)_70%,var(--haze)_100%)]" />
      {state === 'unavailable' && (
        <div className="absolute end-[6%] bottom-[12%] flex w-[min(44%,30rem)] items-end gap-4">
          <span className="w-2/5"><Humaidan sizes="200px" /></span>
          <span className="mb-6 flex-1 rounded-[var(--radius-panel)] bg-ivory p-3"><Logo decorative className="h-auto w-full" sizes="300px" /></span>
        </div>
      )}
    </div>
  );
}

const WASH = 'pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,var(--background)_0%,color-mix(in_srgb,var(--background)_82%,transparent)_34%,transparent_58%)] lg:bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_srgb,var(--background)_78%,transparent)_30%,transparent_54%)] lg:rtl:bg-[linear-gradient(270deg,var(--background)_0%,color-mix(in_srgb,var(--background)_78%,transparent)_30%,transparent_54%)]';

/* ---------- The scroll-driven journey ---------- */

export function Journey() {
  const reduce = useSyncExternalStore(subscribeReduced, () => window.matchMedia(reducedQuery).matches, () => false);
  return reduce ? <JourneyStill /> : <JourneyScroll />;
}

function JourneyScroll() {
  const t = useTranslations('journey');
  const stages = t.raw('stages') as Stage[];
  const labels = [t('arrival'), ...stages.map((s) => s.short)];
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scenes = useRef<(HTMLDivElement | null)[]>([]);
  const fill = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const lastS = useRef(-1);
  const worldHandle = useRef<World | null>(null);

  const measure = useCallback(() => {
    const sec = section.current;
    const stg = stage.current;
    if (!sec || !stg) return 0;
    const rect = sec.getBoundingClientRect();
    const top = parseFloat(getComputedStyle(stg).top) || 0;
    const travel = rect.height - stg.offsetHeight;
    return travel > 0 ? Math.min(1, Math.max(0, (top - rect.top) / travel)) : 0;
  }, []);

  const apply = useCallback((s: number) => {
    scenes.current.forEach((el, k) => {
      if (!el) return;
      const v = sceneVisibility(k, s);
      el.style.opacity = String(v);
      el.style.transform = `translateY(${(1 - v) * (s > k ? -24 : 24)}px)`;
      el.style.visibility = v < 0.01 ? 'hidden' : 'visible';
    });
    if (fill.current) fill.current.style.transform = `scaleX(${s / LAST})`;
    const next = Math.round(s);
    if (next !== activeRef.current) {
      activeRef.current = next;
      setActive(next);
    }
    worldHandle.current?.setPosition(s);
  }, []);

  const frameNow = useCallback(() => {
    const s = toPosition(measure());
    if (Math.abs(s - lastS.current) > 1e-4) {
      lastS.current = s;
      apply(s);
    }
    worldHandle.current?.render();
  }, [apply, measure]);

  const state = useWorld(canvas, stage, (w) => {
    worldHandle.current = w;
    w.setPosition(Math.max(0, lastS.current));
  });

  useEffect(() => {
    let raf = 0;
    let visible = true;
    const loop = () => {
      frameNow();
      if (visible) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(loop);
    });
    if (section.current) io.observe(section.current);
    // Scroll and resize also update at once, so the picture never waits for the next animation frame.
    window.addEventListener('scroll', frameNow, { passive: true });
    window.addEventListener('resize', frameNow);
    frameNow();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('scroll', frameNow);
      window.removeEventListener('resize', frameNow);
    };
  }, [frameNow]);

  const goTo = (k: number) => {
    const sec = section.current;
    const stg = stage.current;
    if (!sec || !stg) return;
    const rect = sec.getBoundingClientRect();
    const top = parseFloat(getComputedStyle(stg).top) || 0;
    const travel = rect.height - stg.offsetHeight;
    window.scrollTo({ top: window.scrollY + rect.top - top + holdCentre(k) * travel, behavior: 'smooth' });
  };

  const Chapter = PREVIEWS[3];

  return (
    <section ref={section} aria-labelledby="journey-title" className="relative h-[520svh]">
      <h2 id="journey-title" className="sr-only">{t('srTitle')}</h2>
      <ol className="sr-only">
        {stages.map((s, i) => <li key={s.title}>{`${i + 2}. ${s.title}: ${s.body}`}</li>)}
      </ol>
      <div ref={stage} className="sticky top-[4.5rem] h-[calc(100svh-4.5rem)] overflow-hidden bg-background">
        <Backdrop state={state} />
        <canvas ref={canvas} aria-hidden className={clsx('absolute inset-0 block h-full w-full transition-opacity duration-1000', state === 'ready' ? 'opacity-100' : 'opacity-0')} />
        {/* A soft wash behind the copy, so the type reads over the city. */}
        <div aria-hidden className={WASH} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--brand-deep)_70%,transparent),transparent)]" />

        <div className="container-page relative z-10 h-full">
          <div ref={(el) => { scenes.current[0] = el; }} inert={active !== 0} className="absolute inset-x-4 top-[5%] sm:inset-x-6 lg:inset-x-8 lg:top-[11%] lg:max-w-[33rem] xl:max-w-[37rem]">
            <HeroCopy />
          </div>
          {stages.map((s, i) => {
            const k = i + 1;
            const Preview = PREVIEWS[i];
            return (
              <div
                key={s.title}
                ref={(el) => { scenes.current[k] = el; }}
                inert={active !== k}
                style={{ opacity: 0, visibility: 'hidden' }}
                className="absolute inset-x-4 top-[4%] grid gap-4 sm:inset-x-6 lg:inset-x-8 lg:top-[10%] lg:max-w-[31rem] xl:max-w-[35rem]"
              >
                <div><SceneCopy index={k} stage={s} /></div>
                {k < LAST && (
                  <div aria-hidden className="w-full max-w-sm overflow-hidden max-lg:max-h-[24svh] max-lg:[mask-image:linear-gradient(black_65%,transparent)] lg:mt-4 lg:max-w-[22rem]">
                    <Preview />
                  </div>
                )}
                {k === LAST && <div aria-hidden className="hidden max-w-[24rem] lg:mt-4 lg:block"><Chapter /></div>}
              </div>
            );
          })}
        </div>

        {/* Progress: the journey's five stops */}
        <nav aria-label={t('progressLabel')} className="absolute inset-x-0 bottom-0 z-10">
          <div className="container-page pb-5 sm:pb-6">
            <div className="relative">
              <span aria-hidden className="absolute inset-x-0 top-[0.4rem] h-px bg-ivory/30" />
              <span ref={fill} aria-hidden className="absolute inset-x-0 top-[0.4rem] h-px origin-left scale-x-0 bg-brand-gold rtl:origin-right" />
              <ol className="relative flex justify-between">
                {labels.map((label, k) => {
                  const current = active === k;
                  const passed = active > k;
                  return (
                    <li key={label}>
                      <button
                        type="button"
                        onClick={() => goTo(k)}
                        aria-current={current ? 'step' : undefined}
                        aria-label={t('goTo', { n: k + 1, title: label })}
                        className="group flex flex-col items-center gap-1.5 text-ivory"
                      >
                        <span className={clsx('size-[0.8rem] rotate-45 border transition-all duration-300', current ? 'scale-125 border-brand-gold bg-brand-gold' : passed ? 'border-brand-gold bg-brand-gold/70' : 'border-ivory/70 bg-forest group-hover:border-ivory')} />
                        <span className={clsx('text-[0.6875rem] font-semibold drop-shadow transition-opacity sm:text-xs', current ? 'opacity-100' : 'opacity-75 group-hover:opacity-100')}>
                          <span className="num">{String(k + 1).padStart(2, '0')}</span>
                          <span className="hidden sm:inline"> {label}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </nav>
      </div>
    </section>
  );
}

/* ---------- Reduced motion: one still establishing shot, then the story as a page ---------- */

function JourneyStill() {
  const t = useTranslations('journey');
  const stages = t.raw('stages') as Stage[];
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useWorld(canvas, frame, (w) => w.setPosition(0));
  return (
    <section aria-labelledby="journey-title">
      <h2 id="journey-title" className="sr-only">{t('srTitle')}</h2>
      <div ref={frame} className="relative h-[calc(100svh-4.5rem)] min-h-[34rem] overflow-hidden">
        <Backdrop state={state} />
        <canvas ref={canvas} aria-hidden className={clsx('absolute inset-0 block h-full w-full', state === 'ready' ? 'opacity-100' : 'opacity-0')} />
        <div aria-hidden className={WASH} />
        <div className="container-page relative h-full">
          <div className="absolute inset-x-4 top-[6%] sm:inset-x-6 lg:inset-x-8 lg:top-[12%] lg:max-w-[34rem]"><HeroCopy animate={false} /></div>
        </div>
      </div>
      <ol className="container-page divide-y divide-border py-8">
        {stages.map((s, i) => {
          const Preview = PREVIEWS[i];
          return (
            <li key={s.title} className="grid gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-center lg:gap-16">
              <div><SceneCopy index={i + 1} stage={s} /></div>
              <div aria-hidden className="max-w-sm lg:max-w-none"><Preview /></div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
