import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Humaidan } from '@/components/brand';
import { Link } from '@/i18n/navigation';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const org = (await searchParams).as === 'organization';
  const t = await getTranslations({ locale });
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-14 text-center">
      {!org && <div className="w-32"><Humaidan sizes="128px" /></div>}
      <h1 className={org ? 'font-display text-3xl font-bold' : 'mt-6 font-display text-3xl font-bold'}>{t('auth.checkTitle')}</h1>
      <p className="mt-3 text-lg text-muted">{t('auth.checkBody')}</p>
      <p className="mt-2 text-sm text-muted">{t('auth.checkNote')}</p>
      <Link href={org ? '/login?as=organization' : '/login'} className="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('nav.login')}</Link>
    </section>
  );
}
