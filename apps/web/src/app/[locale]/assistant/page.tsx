import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AssistantChat } from '@/components/assistant';
import { Humaidan } from '@/components/brand';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

/** Humaidan, the candidate's assistant: answers about their own profile, CV, readiness, roadmap, applications, assessments and interviews. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/assistant', locale });
  const t = await getTranslations({ locale, namespace: 'assistant' });
  return (
    <section className="container-page max-w-4xl space-y-6 py-8 lg:py-10">
      {/* Humaidan, MIDAN's character, is the candidate's assistant: his answers come only from their own records. */}
      <header className="flex items-end gap-5 border-b border-border pb-6">
        <div aria-hidden className="w-20 shrink-0 sm:w-24"><Humaidan outfit="original" sizes="96px" /></div>
        <div className="min-w-0">
          <p className="label-caps">{t('eyebrowCandidate')}</p>
          <h1 className="display-lg mt-2 text-balance">{t('titleCandidate')}</h1>
          <p className="mt-2 max-w-2xl leading-relaxed text-muted">{t('leadCandidate')}</p>
        </div>
      </header>
      <AssistantChat scope="candidate" suggestions={t.raw('suggestCandidate') as string[]} />
    </section>
  );
}
