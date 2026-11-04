import { use } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { Faq } from '@/components/interactive';
import { PageHero } from '@/components/page-kit';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return (
    <>
      <PageHero ns="faq" />
      <section className="mx-auto max-w-4xl px-4 pb-20 sm:px-6"><Faq /></section>
    </>
  );
}
