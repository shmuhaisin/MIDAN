'use client';

import { useTranslations } from 'next-intl';
import { Humaidan } from '@/components/brand';

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations('errorPage');
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
      <div className="w-32"><Humaidan sizes="128px" /></div>
      <h1 className="mt-6 font-display text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-muted">{t('body')}</p>
      <button type="button" onClick={reset} className="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('retry')}</button>
    </section>
  );
}
