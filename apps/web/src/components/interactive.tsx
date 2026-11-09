'use client';

import clsx from 'clsx';
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { number } from '@/lib/format';
import { Arrow, Eyebrow, Humaidan } from './brand';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Content that rises into place once, when it scrolls into view. Without JavaScript it simply shows (see layout). */
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
      data-reveal
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
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

type Scale = { code: string; name: string; body: string }[];

/**
 * MIDAN's five skill levels as a ladder you can read. For each level: what it means (the product's own definition),
 * what it looks like in practice for one skill, and what changed from the level below, side by side. Nothing here is
 * invented: the definitions and examples are the ones the product already states.
 */
export function LevelGuide({ field, value, onChange }: { field: FieldMessage; value: number; onChange: (index: number) => void }) {
  const t = useTranslations('levels');
  const scale = (useMessages() as unknown as { how: { scale: Scale } }).how.scale;
  const level = scale[value];
  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
      <div role="radiogroup" aria-label={t('label')} className="relative flex gap-1 md:flex-col-reverse md:gap-1.5">
        {scale.map((s, i) => {
          const active = i === value;
          return (
            <button
              key={s.code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(i)}
              className={clsx(
                'relative flex flex-1 flex-col items-start gap-0.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-start transition-colors md:flex-none',
                active ? 'border-transparent bg-[var(--button)] text-[var(--button-foreground)]' : i < value ? 'border-primary/30 bg-accent text-accent-foreground' : 'border-border bg-surface text-muted hover:text-foreground',
              )}
            >
              {active && <motion.span layoutId={`level-${field.skill}`} aria-hidden className="absolute inset-y-1.5 start-0 w-0.5 bg-brand-gold" transition={{ duration: 0.3, ease: EASE }} />}
              <span className="num text-xs font-bold">{s.code}</span>
              <span className="hidden text-sm font-semibold md:block">{s.name}</span>
            </button>
          );
        })}
      </div>
      <div aria-live="polite" className="min-w-0">
        <AnimatePresence mode="wait">
          <motion.div key={`${field.skill}-${value}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
            <p className="flex items-baseline gap-3">
              <span className="num font-display text-3xl font-bold text-gold-text">{level.code}</span>
              <span className="font-display text-2xl font-bold">{level.name}</span>
            </p>
            <dl className="mt-5 space-y-5">
              <div>
                <dt className="label-caps">{t('means')}</dt>
                <dd className="mt-1.5 text-lg leading-relaxed">{level.body}</dd>
              </div>
              <div>
                <dt className="label-caps">{t('inPractice', { skill: field.skill })}</dt>
                <dd className="callout mt-2 leading-relaxed">{field.levels[value]}</dd>
              </div>
              <div>
                <dt className="label-caps">{value === 0 ? t('startingPoint') : t('changed', { from: scale[value - 1].code })}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">
                  {value === 0 ? t('startingBody') : (
                    <span className="grid gap-2 sm:grid-cols-2">
                      <span className="rounded-[var(--radius-control)] border border-border px-3 py-2"><span className="num me-1 font-semibold">{scale[value - 1].code}</span>{field.levels[value - 1]}</span>
                      <span className="rounded-[var(--radius-control)] border border-primary/40 bg-accent/50 px-3 py-2 text-foreground"><span className="num me-1 font-semibold">{level.code}</span>{field.levels[value]}</span>
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </motion.div>
        </AnimatePresence>
      </div>
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
    <section className="container-page py-20 lg:py-28">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <Reveal className="lg:col-span-8">
          <Eyebrow className="text-muted">{t('explorerEyebrow')}</Eyebrow>
          <h2 className="display-lg mt-4 max-w-3xl text-balance">{t('explorerTitle')}</h2>
        </Reveal>
        <p className="text-sm leading-relaxed text-muted lg:col-span-4">{t('explorerNote')}</p>
      </div>

      <div role="group" aria-label={t('fieldsLabel')} className="-mx-4 mt-10 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {FIELD_KEYS.map((key) => (
          <button key={key} type="button" aria-pressed={key === fieldKey} onClick={() => setFieldKey(key)} className="chip shrink-0 hover:border-foreground">
            {messages.home.fields[key].label}
          </button>
        ))}
      </div>

      <div className="mt-8 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
        <div className="p-6 sm:p-8 lg:p-10">
          <AnimatePresence mode="wait">
            <motion.div key={fieldKey} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: EASE }}>
              <p className="label-caps">{t('jobSays')}</p>
              <p className="mt-2 text-lg text-muted line-through decoration-gold decoration-2">{field.jobLine}</p>
              <p className="label-caps mt-8 text-primary!">{t('midanAsks')}</p>
              <p className="mt-2 font-display text-2xl leading-snug font-semibold sm:text-[1.75rem]">{field.task}</p>
              <dl className="mt-8 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted">{t('deliverable')}</dt>
                  <dd className="mt-1 font-medium">{field.deliverable}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">{t('skillsMeasured')}</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {field.skills.map((s) => <span key={s} className="rounded-[3px] bg-accent px-2 py-0.5 text-sm font-medium text-accent-foreground">{s}</span>)}
                  </dd>
                </div>
              </dl>
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
      <div className="mt-6 rounded-[var(--radius-panel)] border border-border bg-surface p-6 sm:p-8 lg:p-10">
        <p className="font-semibold">{t('levelsTitle', { skill: field.skill })}</p>
        <p className="mt-1 mb-6 text-sm text-muted">{t('levelsHint')}</p>
        <LevelGuide field={field} value={level} onChange={setLevel} />
      </div>
    </section>
  );
}

function Rail({ title, steps, locale, index }: { title: string; steps: string[]; locale: string; index: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 60%'] });
  const scaleY = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  return (
    <div>
      <p className="flex items-baseline gap-3">
        <span className="num text-sm font-semibold text-brand-gold">{index}</span>
        <span className="font-display text-2xl font-bold text-ivory">{title}</span>
      </p>
      <ol ref={ref} className="relative mt-8">
        <span aria-hidden className="absolute start-[0.95rem] top-2 bottom-2 w-px bg-mint/20" />
        <motion.span aria-hidden style={{ scaleY }} className="absolute start-[0.95rem] top-2 bottom-2 w-px origin-top bg-brand-gold" />
        {steps.map((step, i) => (
          <li key={step} className="relative flex items-center gap-4 pb-5 last:pb-0">
            <span className="num relative grid size-8 shrink-0 place-items-center rounded-full bg-deep-2 text-sm font-semibold text-mint ring-1 ring-mint/40">{number(locale, i + 1)}</span>
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
    <section className="on-deep deep-grain relative overflow-hidden bg-deep text-deep-foreground">
      <div className="container-page relative py-20 lg:py-28">
        <Reveal>
          <Eyebrow className="text-deep-muted">{t('eyebrow')}</Eyebrow>
          <h2 className="display-lg mt-4 max-w-4xl text-balance">{t('title')}</h2>
        </Reveal>
        <div className="mt-14 grid gap-14 md:grid-cols-2 lg:gap-20">
          <Rail index="A" title={t('candidateTitle')} steps={t.raw('candidate') as string[]} locale={locale} />
          <Rail index="B" title={t('orgTitle')} steps={t.raw('org') as string[]} locale={locale} />
        </div>
      </div>
    </section>
  );
}

export function Audience() {
  const t = useTranslations();
  const panels = [
    { title: 'home.candidateTitle', body: 'home.candidateBody', cta: 'journey.ctaCandidate', href: '/register?as=candidate', more: '/for-candidates', moreLabel: 'nav.candidates', figure: true, deep: false },
    { title: 'home.organizationTitle', body: 'home.organizationBody', cta: 'journey.ctaEmployer', href: '/register?as=organization', more: '/for-organizations', moreLabel: 'nav.organizations', figure: false, deep: true },
  ];
  return (
    <section aria-label={t('home.audienceEyebrow')} className="flex flex-col lg:flex-row">
      {panels.map((p) => (
        <div
          key={p.title}
          className={clsx(
            'group relative flex flex-1 overflow-hidden transition-[flex-grow] duration-700 ease-out lg:hover:grow-[1.3] lg:focus-within:grow-[1.3]',
            p.deep ? 'on-deep deep-grain bg-deep-2 text-deep-foreground' : 'bg-accent text-accent-foreground',
          )}
        >
          <div className={clsx('relative z-10 flex w-full flex-col items-start px-4 py-16 sm:px-10 lg:py-24', p.figure && 'pe-[38%] sm:pe-[38%]')}>
            <p className="label-caps text-current! opacity-70">{t(p.deep ? 'nav.organizations' : 'nav.candidates')}</p>
            <h2 className="display-lg mt-3 max-w-md text-balance">{t(p.title)}</h2>
            <p className={clsx('mt-4 max-w-md text-lg leading-relaxed', p.deep ? 'text-deep-muted' : 'opacity-85')}>{t(p.body)}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href={p.href} className={clsx('btn btn-lg', p.deep ? 'btn-gold' : 'btn-primary')}>
                {t(p.cta)}
                <Arrow />
              </Link>
              <Link href={p.more} className="font-semibold underline decoration-1 underline-offset-[0.3em] hover:decoration-2">
                {t(p.moreLabel)}
              </Link>
            </div>
          </div>
          {p.figure && (
            <div aria-hidden className="absolute end-2 bottom-0 w-[36%] max-w-64 transition-transform duration-700 group-hover:-translate-y-1">
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
  const th = useTranslations('home');
  const messages = useMessages() as unknown as { home: { fields: Record<string, FieldMessage> } };
  const [fieldKey, setFieldKey] = useState<(typeof FIELD_KEYS)[number]>('tech');
  const [level, setLevel] = useState(3);
  return (
    <div>
      <div role="group" aria-label={th('fieldsLabel')} className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {FIELD_KEYS.map((key) => (
          <button key={key} type="button" aria-pressed={key === fieldKey} onClick={() => setFieldKey(key)} className="chip shrink-0 hover:border-foreground">
            {messages.home.fields[key].label}
          </button>
        ))}
      </div>
      <LevelGuide field={messages.home.fields[fieldKey]} value={level} onChange={setLevel} />
    </div>
  );
}
