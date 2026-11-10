import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminNav } from '@/components/admin';
import { requirePlatformAdmin } from '@/lib/platform-admin';

/** Only platform administrators: for anyone else /admin doesn't exist (requirePlatformAdmin, then the API's PlatformAdminGuard). */
export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;
  setRequestLocale(locale);
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
