import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Eyebrow, Parapet } from '@/components/brand';
import { Audience, FieldExplorer, Hero, Reveal, Story } from '@/components/interactive';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations('home');
  return (
    <>
      <Hero />
      <Parapet className="text-deep" />
      <div className="on-deep bg-deep py-1" />
      <FieldExplorer />
      <Parapet className="text-deep" />
      <Story />
      <Audience />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <Reveal>
          <Eyebrow className="text-muted">{t('trustEyebrow')}</Eyebrow>
          <h2 className="mt-4 font-display text-4xl leading-tight font-bold sm:text-5xl">{t('trustTitle')}</h2>
          <blockquote className="mt-8 max-w-md border-s-2 border-gold ps-5 text-lg leading-relaxed text-muted">
            {t('closingQuote')}
          </blockquote>
        </Reveal>
        <ul className="divide-y divide-border border-y border-border">
          {(t.raw('trust') as string[]).map((line, i) => (
            <li key={line}>
              <Reveal delay={i * 0.06} className="py-5 font-display text-xl font-semibold sm:text-2xl">
                {line}
              </Reveal>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
