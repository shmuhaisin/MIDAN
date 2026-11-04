import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { PageHero, PointList } from '@/components/page-kit';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations('about');
  return (
    <>
      <PageHero ns="about" outfit="original" />
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <PointList points={t.raw('sections') as { title: string; body: string }[]} />
      </section>
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="border-s-2 border-gold ps-5">
          <h2 className="font-display text-2xl font-semibold">{t('statusTitle')}</h2>
          <p className="mt-2 max-w-2xl text-lg leading-relaxed text-muted">{t('statusBody')}</p>
        </div>
      </section>
    </>
  );
}
