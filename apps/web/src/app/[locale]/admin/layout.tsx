import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminNav } from '@/components/admin';
import { apiForPage } from '@/lib/api';

/** The API refuses anyone who isn't a platform administrator; this page then doesn't exist for them. */
export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const allowed = await apiForPage<unknown>('/admin/overview');
  if (!allowed) notFound();
  const t = await getTranslations({ locale, namespace: 'admin' });
  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <p className="text-sm font-semibold text-muted">{t('eyebrow')}</p>
      <h1 className="page-title">{t('title')}</h1>
      <div className="mt-4"><AdminNav /></div>
      <div className="mt-6">{children}</div>
    </section>
  );
}
