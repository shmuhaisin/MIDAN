import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { LevelLadder } from '@/components/career-client';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { type Career, EMPTY_CAREER } from '@/lib/career';
import { pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Messages = {
  how: { scale: { code: string; name: string; body: string }[] };
  home: { fields: Record<string, { label: string; skill: string; levels: string[] }> };
};

/**
 * MIDAN's L0–L4 skill levels, with the definitions already used across the platform and the worked examples of the
 * public explorer, and the candidate's own released levels marked on the ladder. Levels come only from released
 * assessment results: practice and self-reported skills never set one.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development/levels', locale });
  const career = (await apiForPage<Career>('/me/career')) ?? EMPTY_CAREER;
  const t = await getTranslations({ locale, namespace: 'career' });
  const messages = (await getMessages({ locale })) as unknown as Messages;
  const mine = [...career.demonstrated_strengths, ...career.demonstrated_needs].map((s) => ({ name: pick(locale, s.name_ar, s.name_en), level: s.level }));
  const fields = Object.values(messages.home.fields).filter((f) => Array.isArray(f.levels) && f.levels.length === 5);

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <header className="max-w-3xl">
        <p className="label-caps">{t('levels.eyebrow')}</p>
        <h1 className="display-lg mt-2 text-balance">{t('levels.title')}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t('levels.lead')}</p>
      </header>
      <LevelLadder levels={messages.how.scale} fields={fields} mine={mine} />
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('levels.where')}</p>
    </div>
  );
}
