import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ClosingBand, PageHero, PointList } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  return (
    <>
      <PageHero ns="candidates" art={{ kind: 'humaidan', outfit: 'original' }}>
        <Link href="/register?as=candidate" className="btn btn-primary btn-lg">{t('journey.ctaCandidate')}<Arrow /></Link>
        <Link href="/opportunities" className="btn btn-secondary btn-lg">{t('nav.opportunities')}</Link>
      </PageHero>
      <section className="container-page py-16 lg:py-24">
        <PointList points={t.raw('candidates.points') as { title: string; body: string }[]} />
      </section>
      <ClosingBand title={t('candidates.humaidanTitle')} body={t('candidates.humaidanBody')}>
        <Link href="/register?as=candidate" className="btn btn-primary btn-lg">{t('journey.ctaCandidate')}<Arrow /></Link>
      </ClosingBand>
    </>
  );
}
