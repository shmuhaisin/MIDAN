import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AssistantChat } from '@/components/assistant';
import { Masthead } from '@/components/workspace-kit';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

/** The organization's assistant: answers about this organization's jobs, applicants, assessments and interviews only. */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId) || !(await apiForPage<unknown>(`/organizations/${orgId}`))) notFound();
  const t = await getTranslations({ locale, namespace: 'assistant' });
  return (
    <div className="space-y-6">
      <Masthead eyebrow={t('eyebrow')} title={t('title')} lead={t('leadOrganization')} />
      <AssistantChat scope="organization" orgId={orgId} suggestions={t.raw('suggestOrganization') as string[]} />
    </div>
  );
}
