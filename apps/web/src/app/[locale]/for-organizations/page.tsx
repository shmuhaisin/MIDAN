import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { PageHero, PointList } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  return (
    <>
      <PageHero ns="organizations" outfit="legal" />
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <PointList points={t.raw('organizations.points') as { title: string; body: string }[]} />
      </section>
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <h2 className="font-display text-3xl font-bold">{t('organizations.notTitle')}</h2>
        <ul className="mt-5 space-y-2 text-xl text-muted">
          {(t.raw('organizations.not') as string[]).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <Link href="/register?as=organization" className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">
          {t('cta.organization')}<Arrow />
        </Link>
      </section>
    </>
  );
}
