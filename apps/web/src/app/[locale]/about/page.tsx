import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { ClosingBand, PageHero, PointList } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  return (
    <>
      <PageHero ns="about" art={{ kind: 'humaidan', outfit: 'original' }} />
      <section className="container-page py-16 lg:py-24">
        <PointList points={t.raw('about.sections') as { title: string; body: string }[]} />
        <div className="callout mt-14 max-w-3xl">
          <h2 className="section-title">{t('about.statusTitle')}</h2>
          <p className="mt-2 leading-relaxed text-muted">{t('about.statusBody')}</p>
        </div>
      </section>
      <ClosingBand title={t('journey.finalTitle')}>
        <Link href="/register?as=candidate" className="btn btn-primary btn-lg">{t('journey.ctaCandidate')}</Link>
        <Link href="/register?as=organization" className="btn btn-secondary btn-lg">{t('journey.ctaEmployer')}</Link>
      </ClosingBand>
    </>
  );
}
