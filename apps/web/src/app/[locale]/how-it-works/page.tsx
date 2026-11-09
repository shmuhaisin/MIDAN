import { use } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Eyebrow } from '@/components/brand';
import { Reveal, ScaleExplorer } from '@/components/interactive';
import { ClosingBand, PageHero } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';
import { number } from '@/lib/format';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  const locale = useLocale();
  const steps = t.raw('how.steps') as { title: string; body: string }[];
  return (
    <>
      <PageHero ns="how" art={{ kind: 'steps', steps: steps.map((s) => s.title) }} />
      <section className="container-page py-16 lg:py-24">
        <ol className="relative">
          <span aria-hidden className="absolute start-5 top-10 bottom-10 hidden w-px bg-border-strong md:block" />
          {steps.map((s, i) => (
            <li key={s.title} className="relative">
              <Reveal className="grid gap-3 border-b border-border py-9 md:grid-cols-12 md:gap-8">
                <span className="relative flex items-start gap-4 md:col-span-5">
                  <span className="num relative z-10 grid size-10 shrink-0 place-items-center rounded-full border border-gold bg-background font-display font-bold text-gold-text">{number(locale, i + 1)}</span>
                  <h2 className="pt-1 font-display text-2xl font-bold">{s.title}</h2>
                </span>
                <p className="text-lg leading-relaxed text-muted md:col-span-7 md:pt-1.5">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>
      <section className="border-y border-border bg-surface">
        <div className="container-page py-16 lg:py-24">
          <Eyebrow className="text-muted">{t('how.scaleEyebrow')}</Eyebrow>
          <h2 className="display-lg mt-4 max-w-3xl text-balance">{t('how.scaleTitle')}</h2>
          <p className="mt-4 mb-10 max-w-2xl text-lg text-muted">{t('how.scaleLead')}</p>
          <ScaleExplorer />
        </div>
      </section>
      <ClosingBand title={t('journey.finalTitle')}>
        <Link href="/register?as=candidate" className="btn btn-primary btn-lg">{t('journey.ctaCandidate')}</Link>
        <Link href="/register?as=organization" className="btn btn-secondary btn-lg">{t('journey.ctaEmployer')}</Link>
      </ClosingBand>
    </>
  );
}
