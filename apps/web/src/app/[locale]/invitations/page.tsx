import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InvitationCard, type MyInvitation } from '@/components/organization-team';
import { EmptyState } from '@/components/ui';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: 'invitations' });
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const invitations = (await apiForPage<MyInvitation[]>('/me/invitations')) ?? [];
  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="page-title">{t('title')}</h1>
      <p className="mt-2 mb-6 text-muted">{t('lead')}</p>
      {invitations.length === 0
        ? <EmptyState title={t('empty')} body={t('emptyBody')} />
        : <ul className="space-y-3">{invitations.map((i) => <InvitationCard key={i.id} invitation={i} />)}</ul>}
    </section>
  );
}
