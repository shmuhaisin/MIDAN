import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Faq } from '@/components/interactive';
import { PageHero } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations();
  return (
    <>
      <PageHero ns="faq" />
      <section className="container-page grid gap-12 py-14 lg:grid-cols-12 lg:py-20">
        <div className="lg:col-span-8"><Faq /></div>
        <aside className="lg:col-span-4">
          <div className="callout lg:sticky lg:top-28">
            <p className="section-title">{t('nav.how')}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t('how.lead')}</p>
            <Link href="/how-it-works" className="link mt-4 inline-block text-sm">{t('cta.how')}</Link>
          </div>
        </aside>
      </section>
    </>
  );
}
