import { useTranslations } from 'next-intl';
import { Humaidan } from '@/components/brand';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
      <div className="w-36"><Humaidan sizes="144px" /></div>
      <h1 className="mt-6 font-display text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-muted">{t('body')}</p>
      <Link href="/" className="mt-6 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('home')}</Link>
    </section>
  );
}
