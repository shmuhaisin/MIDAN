import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Eyebrow } from '@/components/brand';
import { Audience, FieldExplorer, Journeys, Reveal } from '@/components/interactive';
import { Journey } from '@/components/journey/journey';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations('home');
  return (
    <>
      <Journey />
      <Journeys />
      <FieldExplorer />
      <Audience />
      <section className="container-page grid gap-12 py-20 lg:grid-cols-12 lg:py-28">
        <Reveal className="lg:col-span-5">
          <Eyebrow className="text-muted">{t('trustEyebrow')}</Eyebrow>
          <h2 className="display-lg mt-4 text-balance">{t('trustTitle')}</h2>
          <blockquote className="mt-8 max-w-md border-s-2 border-gold ps-5 text-lg leading-relaxed text-muted">
            {t('closingQuote')}
          </blockquote>
        </Reveal>
        <ol className="border-t border-border-strong lg:col-span-7">
          {(t.raw('trust') as string[]).map((line, i) => (
            <li key={line} className="border-b border-border">
              <Reveal delay={i * 0.06} className="flex items-baseline gap-5 py-6">
                <span className="num text-sm font-semibold text-gold-text">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-display text-xl font-semibold sm:text-2xl">{line}</span>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
