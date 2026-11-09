import { use } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ClosingBand, PageHero, PointList } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';
import { number } from '@/lib/format';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  const locale = useLocale();
  return (
    <>
      <PageHero ns="organizations" art={{ kind: 'logo' }}>
        <Link href="/register?as=organization" className="btn btn-primary btn-lg">{t('journey.ctaEmployer')}<Arrow /></Link>
        <Link href="/how-it-works" className="btn btn-secondary btn-lg">{t('nav.how')}</Link>
      </PageHero>
      <section className="container-page py-16 lg:py-24">
        <PointList points={t.raw('organizations.points') as { title: string; body: string }[]} />
      </section>
      <section className="border-y border-border bg-surface">
        <div className="container-page grid gap-8 py-16 lg:grid-cols-12 lg:py-20">
          <h2 className="display-lg lg:col-span-5">{t('organizations.notTitle')}</h2>
          <ul className="divide-y divide-border border-y border-border lg:col-span-7">
            {(t.raw('organizations.not') as string[]).map((line, i) => (
              <li key={line} className="flex items-baseline gap-5 py-5 font-display text-xl font-semibold sm:text-2xl">
                <span className="num text-sm text-gold-text">{number(locale, i + 1)}</span>
                <span className="text-muted line-through decoration-gold decoration-2">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <ClosingBand title={t('organizations.title')} body={t('organizations.lead')}>
        <Link href="/register?as=organization" className="btn btn-primary btn-lg">{t('journey.ctaEmployer')}<Arrow /></Link>
      </ClosingBand>
    </>
  );
}
