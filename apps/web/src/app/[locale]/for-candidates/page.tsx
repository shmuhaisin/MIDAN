import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Arrow, Humaidan } from '@/components/brand';
import { PageHero, PointList } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  return (
    <>
      <PageHero ns="candidates" />
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <PointList points={t.raw('candidates.points') as { title: string; body: string }[]} />
      </section>
      <section className="mx-auto mt-16 grid max-w-7xl items-center gap-6 px-4 pb-16 sm:grid-cols-[auto_1fr] sm:gap-10 sm:px-6 lg:pb-24">
        <div className="mx-auto w-32 sm:w-40"><Humaidan sizes="160px" /></div>
        <div>
          <h2 className="font-display text-3xl font-bold">{t('candidates.humaidanTitle')}</h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('candidates.humaidanBody')}</p>
          <Link href="/register?as=candidate" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">
            {t('cta.candidate')}<Arrow />
          </Link>
        </div>
      </section>
    </>
  );
}
