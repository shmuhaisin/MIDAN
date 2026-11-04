import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Humaidan } from '@/components/brand';
import { PageHero } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'start' });
  const kind = (await searchParams).as === 'organization' ? 'organization' : 'candidate';
  return (
    <>
      <PageHero ns="start" />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-20 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-8">
          <nav aria-label={t('tabsLabel')} className="inline-flex rounded-full border border-border p-1">
            {(['candidate', 'organization'] as const).map((k) => (
              <Link
                key={k}
                href={`/get-started?as=${k}`}
                scroll={false}
                aria-current={k === kind ? 'page' : undefined}
                className={clsx(
                  'rounded-full px-5 py-2 text-sm font-semibold transition-colors',
                  k === kind ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {t(`${k}Tab`)}
              </Link>
            ))}
          </nav>
          <h2 className="mt-8 font-display text-2xl font-semibold">{t(`${kind}Title`)}</h2>
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {(t.raw(`${kind}Items`) as string[]).map((item) => (
              <li key={item} className="py-4 text-lg">{item}</li>
            ))}
          </ul>
          <Link href="/how-it-works" className="mt-8 inline-flex items-center gap-2 font-semibold text-primary underline decoration-1 underline-offset-4">
            {t('back')}<Arrow />
          </Link>
        </div>
        <div className="mx-auto w-44 md:col-span-4 md:w-56"><Humaidan sizes="224px" /></div>
      </section>
    </>
  );
}
