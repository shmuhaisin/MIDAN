'use client';

import clsx from 'clsx';
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { number } from '@/lib/format';
import { Arrow, Eyebrow, Humaidan, TriangleField } from './brand';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Hero() {
  const t = useTranslations();
  return (
    <section className="relative mx-auto grid max-w-7xl gap-8 px-4 pt-8 sm:px-6 lg:grid-cols-12 lg:items-end lg:gap-4 lg:pt-10">
      <div className="pb-6 lg:col-span-7 lg:pb-20">
        <Eyebrow className="text-muted">{t('home.eyebrow')}</Eyebrow>
        <h1 className="mt-6 font-display text-[2.5rem] leading-[1.25] font-bold sm:text-6xl xl:text-[4.25rem]">
          <span className="block">
            {t('home.heroLine1')}{' '}
            <span className="relative inline-block text-muted">
              {t('home.heroStrike')}
              <motion.span
                aria-hidden
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
                className="absolute inset-x-0 top-[55%] h-[0.09em] origin-left bg-gold rtl:origin-right"
              />
            </span>
          </span>
          <motion.span
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.85, ease: EASE }}
            className="mt-1 block text-primary"
          >
            {t('home.heroLine2')}
          </motion.span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{t('home.heroLead')}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link
            href="/register?as=candidate"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            {t('cta.candidate')}
            <Arrow className="transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
          </Link>
          <Link
            href="/register?as=organization"
            className="inline-flex items-center justify-center rounded-full border border-foreground/30 px-6 py-3.5 font-semibold transition-colors hover:bg-surface-2"
          >
            {t('cta.organization')}
          </Link>
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-md lg:col-span-5 lg:max-w-none">
        <div className="najdi-arch relative mx-auto aspect-[5/6] w-[88%] overflow-hidden bg-deep text-mint/15">
          <TriangleField />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"
        >
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
            <Humaidan sizes="(min-width: 1024px) 30vw, 70vw" priority />
          </motion.div>
        </motion.div>
        <motion.p
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 1.2 }}
          className="absolute end-0 top-[20%] rounded-2xl rounded-es-sm bg-surface px-4 py-2.5 text-sm font-semibold shadow-soft"
        >
          {t('home.bubble')}
        </motion.p>
      </div>
    </section>
  );
}

type FieldMessage = {
  label: string;
  jobLine: string;
  task: string;
  deliverable: string;
  skills: string[];
  skill: string;
  levels: string[];
};

const FIELD_KEYS = ['tech', 'finance', 'legal', 'engineering', 'events', 'healthcare'] as const;

export function LevelStairs({
  levels,
  value,
  onChange,
  label,
  buttonLabel,
}: {
  levels: string[];
  value: number;
  onChange: (index: number) => void;
  label: string;
  buttonLabel: (index: number) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-end gap-1">
      {levels.map((_, i) => {
        const active = i === value;
        return (
          <button
            key={i}
            type="button"
            aria-pressed={active}
            aria-label={buttonLabel(i)}
            onClick={() => onChange(i)}
            style={{ height: `${2.75 + i * 0.75}rem` }}
            className={clsx(
              'min-w-11 flex-1 rounded-t-md pt-1.5 pb-1 text-sm font-semibold transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : i < value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-surface-2 text-muted hover:text-foreground',
            )}
          >
            L{i}
          </button>
        );
      })}
    </div>
  );
}

export function FieldExplorer() {
  const t = useTranslations('home');
  const messages = useMessages() as unknown as { home: { fields: Record<string, FieldMessage> } };
  const [fieldKey, setFieldKey] = useState<(typeof FIELD_KEYS)[number]>('tech');
  const [level, setLevel] = useState(3);
  const field = messages.home.fields[fieldKey];

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
      <Reveal>
        <Eyebrow className="text-muted">{t('explorerEyebrow')}</Eyebrow>
        <h2 className="mt-4 max-w-3xl font-display text-3xl leading-tight font-bold sm:text-4xl">{t('explorerTitle')}</h2>
      </Reveal>

      <div role="group" aria-label={t('fieldsLabel')} className="-mx-4 mt-8 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {FIELD_KEYS.map((key) => {
          const active = key === fieldKey;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setFieldKey(key)}
              className={clsx(
                'relative shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                active ? 'border-transparent text-primary-foreground' : 'border-border text-muted hover:text-foreground',
              )}
            >
              {active && <motion.span layoutId="field-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ duration: 0.25, ease: EASE }} />}
              <span className="relative">{messages.home.fields[key].label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:gap-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={fieldKey}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="lg:col-span-7"
          >
            <p className="text-sm font-medium text-muted">{t('jobSays')}</p>
            <p className="mt-2 text-lg text-muted line-through decoration-gold decoration-1">{field.jobLine}</p>
            <p className="mt-8 text-sm font-medium text-primary">{t('midanAsks')}</p>
            <p className="mt-2 text-2xl leading-snug font-semibold sm:text-[1.7rem]">{field.task}</p>
            <dl className="mt-8 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">{t('deliverable')}</dt>
                <dd className="mt-1 font-medium">{field.deliverable}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{t('skillsMeasured')}</dt>
                <dd className="mt-1 font-medium">{field.skills.join(' · ')}</dd>
              </div>
            </dl>
          </motion.div>
        </AnimatePresence>

        <div className="rounded-lg bg-surface p-5 lg:col-span-5">
          <p className="font-semibold">{t('levelsTitle', { skill: field.skill })}</p>
          <p className="mt-1 text-sm text-muted">{t('levelsHint')}</p>
          <div className="mt-5">
            <LevelStairs
              levels={field.levels}
              value={level}
              onChange={setLevel}
              label={t('levelsHint')}
              buttonLabel={(i) => t('levelButton', { level: i })}
            />
          </div>
          <p aria-live="polite" className="mt-4 min-h-20 border-t border-border pt-4 leading-relaxed">
            {field.levels[level]}
          </p>
        </div>
      </div>
      <p className="mt-6 text-sm text-muted">{t('explorerNote')}</p>
    </section>
  );
}

function Rail({ title, steps, locale }: { title: string; steps: string[]; locale: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 60%'] });
  const scaleY = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  return (
    <div>
      <h3 className="font-display text-2xl font-semibold text-mint">{title}</h3>
      <ol ref={ref} className="relative mt-6">
        <span aria-hidden className="absolute start-[0.95rem] top-2 bottom-2 w-px bg-mint/20" />
        <motion.span aria-hidden style={{ scaleY }} className="absolute start-[0.95rem] top-2 bottom-2 w-px origin-top bg-mint" />
        {steps.map((step, i) => (
          <li key={step} className="relative flex items-center gap-4 pb-5 last:pb-0">
            <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-deep-2 text-sm font-semibold text-mint ring-1 ring-mint/40">{number(locale, i + 1)}</span>
            <span className="text-lg">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Journeys() {
  const t = useTranslations('home.flow');
  const locale = useLocale();
  return (
    <section className="on-deep relative bg-deep text-deep-foreground">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <Eyebrow className="text-deep-muted">{t('eyebrow')}</Eyebrow>
        <h2 className="mt-4 max-w-4xl font-display text-4xl leading-tight font-bold sm:text-5xl">{t('title')}</h2>
        <div className="mt-12 grid gap-12 md:grid-cols-2">
          <Rail title={t('orgTitle')} steps={t.raw('org') as string[]} locale={locale} />
          <Rail title={t('candidateTitle')} steps={t.raw('candidate') as string[]} locale={locale} />
        </div>
      </div>
    </section>
  );
}

export function Audience() {
  const t = useTranslations();
  const panels = [
    { title: 'home.candidateTitle', body: 'home.candidateBody', cta: 'cta.candidate', href: '/register?as=candidate', more: '/for-candidates', moreLabel: 'nav.candidates', figure: true, deep: false },
    { title: 'home.organizationTitle', body: 'home.organizationBody', cta: 'cta.organization', href: '/register?as=organization', more: '/for-organizations', moreLabel: 'nav.organizations', figure: false, deep: true },
  ];
  return (
    <section aria-label={t('home.audienceEyebrow')} className="flex flex-col lg:flex-row">
      {panels.map((p) => (
        <div
          key={p.title}
          className={clsx(
            'group relative flex flex-1 overflow-hidden transition-[flex-grow] duration-500 ease-out lg:hover:grow-[1.35] lg:focus-within:grow-[1.35]',
            p.deep ? 'on-deep bg-deep-2 text-deep-foreground' : 'bg-accent text-accent-foreground',
          )}
        >
          <div className={clsx('relative z-10 flex w-full flex-col items-start px-4 py-14 sm:px-10 lg:py-20', p.figure && 'pe-[38%] sm:pe-[38%]')}>
            <h2 className="font-display text-3xl leading-tight font-bold sm:text-4xl">{t(p.title)}</h2>
            <p className={clsx('mt-4 max-w-md text-lg leading-relaxed', p.deep ? 'text-deep-muted' : '')}>{t(p.body)}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href={p.href}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold transition-transform hover:-translate-y-0.5',
                  p.deep ? 'bg-mint text-forest' : 'bg-forest text-ivory',
                )}
              >
                {t(p.cta)}
                <Arrow />
              </Link>
              <Link href={p.more} className="font-medium underline decoration-1 underline-offset-4">
                {t(p.moreLabel)}
              </Link>
            </div>
          </div>
          {p.figure && (
            <div aria-hidden className="absolute end-2 bottom-0 w-[36%] max-w-60">
              <Humaidan sizes="(min-width: 1024px) 16vw, 36vw" />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function Faq() {
  const t = useTranslations('faq');
  const items = t.raw('items') as { q: string; a: string }[];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <h2>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-6 py-5 text-start text-lg font-semibold transition-colors hover:text-primary"
              >
                {item.q}
                <motion.svg animate={{ rotate: isOpen ? 45 : 0 }} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5 shrink-0" aria-hidden>
                  <path d="M10 4v12M4 10h12" />
                </motion.svg>
              </button>
            </h2>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={`faq-${i}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <p className="max-w-3xl pb-6 leading-relaxed text-muted">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export function ScaleExplorer() {
  const t = useTranslations('how');
  const scale = t.raw('scale') as { code: string; name: string; body: string }[];
  const [level, setLevel] = useState(3);
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
      <LevelStairs
        levels={scale.map((s) => s.code)}
        value={level}
        onChange={setLevel}
        label={t('scaleTitle')}
        buttonLabel={(i) => scale[i].name}
      />
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div key={level} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <p className="font-display text-3xl font-bold">
              {scale[level].code} · {scale[level].name}
            </p>
            <p className="mt-2 text-lg leading-relaxed text-muted">{scale[level].body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
