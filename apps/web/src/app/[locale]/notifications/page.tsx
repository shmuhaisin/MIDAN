import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NotificationsList } from '@/components/candidate';
import { CandidateNav } from '@/components/candidate-nav';
import { apiForPage } from '@/lib/api';

type Item = { id: string; kind: string; params: { job_ar?: string; job_en?: string }; link: string; read_at: string | null; created_at: string };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [items, me] = await Promise.all([apiForPage<Item[]>('/me/notifications'), apiForPage<{ candidate_profiles: { time_zone: string } | null }>('/me')]);
  const t = await getTranslations({ locale, namespace: 'notifications' });
  return (
    <>
      <CandidateNav current="notifications" unread={(items ?? []).filter((n) => !n.read_at).length} />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="mb-6 font-display text-4xl font-bold">{t('title')}</h1>
        <NotificationsList items={items ?? []} timeZone={me?.candidate_profiles?.time_zone ?? 'Asia/Riyadh'} />
      </section>
    </>
  );
}
