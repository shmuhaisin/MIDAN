import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InvitationCard, type MyInvitation } from '@/components/organization-team';
import { EmptyState, PageHeader } from '@/components/ui';
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
    <section className="container-page max-w-4xl py-8 lg:py-10">
      <PageHeader title={t('title')} lead={t('lead')} className="mb-8" />
      {invitations.length === 0
        ? <EmptyState title={t('empty')} body={t('emptyBody')} />
        : <ul className="space-y-3">{invitations.map((i) => <InvitationCard key={i.id} invitation={i} />)}</ul>}
    </section>
  );
}
