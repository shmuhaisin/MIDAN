import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NotificationsList } from '@/components/candidate';
import { apiForPage } from '@/lib/api';
import { Masthead } from '@/components/workspace-kit';

type Item = { id: string; kind: string; params: { job_ar?: string; job_en?: string }; link: string; read_at: string | null; created_at: string };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [items, me] = await Promise.all([apiForPage<Item[]>('/me/notifications'), apiForPage<{ candidate_profiles: { time_zone: string } | null }>('/me')]);
  const t = await getTranslations({ locale, namespace: 'notifications' });
  const tc = await getTranslations({ locale, namespace: 'candidateNav' });
  return (
    <>
      <section className="container-page max-w-4xl py-8 lg:py-10">
        <div className="mb-8"><Masthead eyebrow={tc('notifications')} title={t('title')} /></div>
        <NotificationsList items={items ?? []} timeZone={me?.candidate_profiles?.time_zone ?? 'Asia/Riyadh'} />
      </section>
    </>
  );
}
