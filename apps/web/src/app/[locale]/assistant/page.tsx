import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AssistantChat } from '@/components/assistant';
import { Masthead } from '@/components/workspace-kit';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

/** The candidate's assistant: answers about their own profile, career plan, applications, assessments and interviews. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/assistant', locale });
  const t = await getTranslations({ locale, namespace: 'assistant' });
  return (
    <section className="container-page max-w-4xl space-y-6 py-8 lg:py-10">
      <Masthead eyebrow={t('eyebrow')} title={t('title')} lead={t('leadCandidate')} />
      <AssistantChat scope="candidate" suggestions={t.raw('suggestCandidate') as string[]} />
    </section>
  );
}
