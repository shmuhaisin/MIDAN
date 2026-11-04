import { use } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Eyebrow } from '@/components/brand';
import { Reveal, ScaleExplorer } from '@/components/interactive';
import { PageHero } from '@/components/page-kit';
import { number } from '@/lib/format';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations('how');
  const locale = useLocale();
  return (
    <>
      <PageHero ns="how" outfit="engineering" />
      <ol className="mx-auto max-w-7xl border-t border-border px-4 sm:px-6">
        {(t.raw('steps') as { title: string; body: string }[]).map((s, i) => (
          <li key={s.title} className="border-b border-border">
            <Reveal className="grid gap-2 py-8 md:grid-cols-12 md:gap-6">
              <span className="font-display text-4xl font-bold text-primary md:col-span-1">{number(locale, i + 1)}</span>
              <h2 className="font-display text-2xl font-semibold md:col-span-4">{s.title}</h2>
              <p className="text-lg leading-relaxed text-muted md:col-span-7">{s.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <Eyebrow className="text-muted">{t('scaleEyebrow')}</Eyebrow>
        <h2 className="mt-4 font-display text-3xl font-bold sm:text-4xl">{t('scaleTitle')}</h2>
        <p className="mt-3 mb-10 max-w-2xl text-lg text-muted">{t('scaleLead')}</p>
        <ScaleExplorer />
      </section>
    </>
  );
}
