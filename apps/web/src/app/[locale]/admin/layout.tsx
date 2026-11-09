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
    <div className="flex-1 bg-surface-2/40">
      <div className="container-page grid gap-6 py-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <aside className="on-deep deep-grain overflow-hidden rounded-[var(--radius-panel)] bg-deep text-deep-foreground lg:sticky lg:top-24 lg:self-start">
          <div className="border-b border-mint/15 px-5 py-5">
            <p className="label-caps text-brand-gold!">{t('eyebrow')}</p>
            <p className="mt-1 font-display text-xl font-bold">{t('title')}</p>
          </div>
          <div className="p-2"><AdminNav /></div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
