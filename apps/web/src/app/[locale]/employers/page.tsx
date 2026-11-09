import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { number, pick } from '@/lib/format';

type Employer = {
  id: string; source_company_id: string; name_ar: string; name_en: string; entity_type: string | null; sector: string | null;
  official_website: string | null; career_url: string | null; verification_status: string; partnership_status: string; open_jobs: number;
  employer_aliases: { name_variant: string; language: string; alias_status: string }[];
  match: { matched_by: 'official_name' | 'alias' | 'company_id'; matched_text: string; alias_status: string | null; exact: boolean } | null;
};

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }> }) {
  const { locale } = await params;
  const { q = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'employers' });
  const tn = await getTranslations({ locale, namespace: 'nav' });
  const employers = await api<Employer[]>(`/reference/employers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  const status = (key: string, value: string) => (t.has(`${key}.${value}`) ? t(`${key}.${value}`) : value);
  return (
    <section className="container-page py-10 lg:py-14">
      <PageHeader eyebrow={tn('employers')} title={t('title')} lead={t('lead')}>
        <Link href="/opportunities" className="btn btn-secondary btn-sm"><Icon name="briefcase" className="size-4" />{t('jobs')}</Link>
      </PageHeader>

      <form role="search" className="mt-8 flex max-w-2xl flex-wrap gap-2">
        <label htmlFor="employer-q" className="sr-only">{t('searchLabel')}</label>
        <span className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input id="employer-q" name="q" defaultValue={q} placeholder={t('searchPlaceholder')} className="input mt-0 ps-10" />
        </span>
        <button type="submit" className="btn btn-primary">{t('search')}</button>
        {q && <Link href="/employers" className="btn btn-ghost">{t('clear')}</Link>}
      </form>
      <p className="mt-6 mb-3 text-sm text-muted" role="status">{q ? t('resultCount', { count: employers.length, q }) : t('count', { count: employers.length })}</p>

      {employers.length === 0 ? <EmptyState title={t('noneTitle')} body={t('noneBody')} /> : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
          {employers.map((e) => {
            const aliases = e.employer_aliases.filter((a) => a.name_variant !== e.name_ar && a.name_variant !== e.name_en);
            const name = pick(locale, e.name_ar, e.name_en);
            return (
              <li key={e.id} className="group grid gap-3 px-4 py-5 transition-colors hover:bg-surface-2/50 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-6">
                <span aria-hidden className="hidden size-12 place-items-center rounded-[var(--radius-panel)] bg-accent font-display text-lg font-bold text-accent-foreground sm:grid">{name.trim().charAt(0)}</span>
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/employers/${e.id}`} className="font-display text-lg font-bold underline-offset-4 group-hover:text-primary hover:underline">{name}</Link>
                    <Badge tone={e.verification_status === 'verified_official' ? 'active' : 'warning'}>{status('status', e.verification_status)}</Badge>
                  </h2>
                  <p className="mt-0.5 text-sm text-muted">{pick(locale, e.name_en, e.name_ar)}{e.sector && ` · ${e.sector}`}</p>
                  {e.match && (
                    <p className="mt-1.5 text-sm">
                      {e.match.matched_by === 'alias'
                        ? t('matchedAlias', { alias: e.match.matched_text, status: status('aliasStatus', e.match.alias_status ?? '') })
                        : e.match.matched_by === 'company_id' ? t('matchedId', { id: e.match.matched_text }) : t('matchedName')}
                    </p>
                  )}
                  {aliases.length > 0 && (
                    <p className="mt-1 text-sm"><span className="text-muted">{t('alsoKnownAs')}: </span>{aliases.map((a) => a.name_variant).join(locale === 'ar' ? '، ' : ', ')}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm sm:justify-end">
                  <span className="text-muted">{status('partnership', e.partnership_status)}</span>
                  <span className="num font-semibold">{t('openJobs', { count: number(locale, e.open_jobs) })}</span>
                  <Link href={`/employers/${e.id}`} className="link">{t('profile')}</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
