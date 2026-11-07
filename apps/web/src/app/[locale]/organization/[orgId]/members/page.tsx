import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MembersPanel, type Member, type Invitation } from '@/components/members';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params; setRequestLocale(locale);
  if (!await getSession()) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await apiForPage<{ my_role: string; name_ar: string; name_en: string }>(`/organizations/${orgId}`);
  if (!org) notFound();
  const members = await apiForPage<Member[]>(`/organizations/${orgId}/members`);
  const invitations = ['owner', 'admin'].includes(org.my_role) ? await apiForPage<Invitation[]>(`/organizations/${orgId}/invitations`) : [];
  if (!members || !invitations) notFound();
  const t = await getTranslations('members');
  return <section className="mx-auto max-w-4xl space-y-6 px-4 py-12"><Link className="underline" href={`/organization/${orgId}`}>{t('back')}</Link><h1 className="font-display text-3xl font-bold">{t('title')}</h1><p>{locale === 'ar' ? org.name_ar : org.name_en}</p><MembersPanel org={orgId} members={members} invitations={invitations} myRole={org.my_role} /></section>;
}
