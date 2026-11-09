import { use } from 'react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { ClosingBand, PageHero } from '@/components/page-kit';
import { Link } from '@/i18n/navigation';

type Capability = { title: string; body: string; evidence: string };

/**
 * The product showcase for investors and partners: what MIDAN does today, what runs on real services, and what isn't
 * built yet, in plain words. Every "works today" line names how it was checked. No customers, revenue, traction or
 * prices are claimed, and no demo credentials appear here (they're local to the demo machine).
 */
export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations('showcase');
  const group = (key: 'works' | 'real' | 'planned', tone: string, icon: 'check' | 'shield' | 'clock') => (
    <section aria-labelledby={key} className="space-y-5">
      <div className="max-w-3xl">
        <p className={`label-caps ${tone}`}>{t(`${key}.eyebrow`)}</p>
        <h2 id={key} className="section-title mt-2">{t(`${key}.title`)}</h2>
        <p className="mt-2 leading-relaxed text-muted">{t(`${key}.lead`)}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(t.raw(`${key}.items`) as Capability[]).map((c) => (
          <li key={c.title} className="flex flex-col rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <p className="flex items-start gap-2 font-display text-lg leading-snug font-bold"><Icon name={icon} className={`mt-1 size-4 ${tone}`} />{c.title}</p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{c.body}</p>
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted"><span className="font-semibold text-foreground">{t('evidence')}: </span>{c.evidence}</p>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <>
      <PageHero ns="showcase" art={{ kind: 'humaidan', outfit: 'original' }} />
      <div className="container-page space-y-16 py-16 lg:py-20">
        {group('works', 'text-primary', 'check')}
        {group('real', 'text-gold-text', 'shield')}
        <section aria-labelledby="path" className="on-deep deep-grain rounded-[var(--radius-panel)] bg-deep p-6 text-deep-foreground sm:p-10">
          <p className="label-caps text-gold">{t('path.eyebrow')}</p>
          <h2 id="path" className="display-lg mt-2 text-ivory">{t('path.title')}</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(t.raw('path.steps') as { who: string; title: string; body: string }[]).map((s, i) => (
              <li key={s.title} className="rounded-[var(--radius-control)] border border-mint/20 p-5">
                <p className="flex items-center justify-between text-xs font-semibold text-gold"><span>{s.who}</span><span className="num">{String(i + 1).padStart(2, '0')}</span></p>
                <p className="mt-2 font-display text-lg font-bold text-ivory">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-deep-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-deep-muted">{t('path.note')}</p>
        </section>
        {group('planned', 'text-muted', 'clock')}
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('honesty')}</p>
      </div>
      <ClosingBand title={t('closing')}>
        <Link href="/opportunities" className="btn btn-primary btn-lg">{t('ctaExplore')}</Link>
        <Link href="/for-organizations" className="btn btn-secondary btn-lg">{t('ctaOrganizations')}</Link>
      </ClosingBand>
    </>
  );
}
