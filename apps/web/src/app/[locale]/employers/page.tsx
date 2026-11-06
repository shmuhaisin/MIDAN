import { getTranslations, setRequestLocale } from 'next-intl/server';
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
  const employers = await api<Employer[]>(`/reference/employers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  const status = (key: string, value: string) => (t.has(`${key}.${value}`) ? t(`${key}.${value}`) : value);
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title={t('title')} lead={t('lead')} className="mb-5">
        <Link href="/opportunities" className="text-sm font-semibold text-primary underline underline-offset-4">{t('jobs')}</Link>
      </PageHeader>
      <form role="search" className="mb-6 flex max-w-xl flex-wrap gap-2">
        <label htmlFor="employer-q" className="sr-only">{t('searchLabel')}</label>
        <input id="employer-q" name="q" defaultValue={q} placeholder={t('searchPlaceholder')} className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3.5" />
        <button type="submit" className="min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-foreground">{t('search')}</button>
        {q && <Link href="/employers" className="self-center text-sm underline underline-offset-4">{t('clear')}</Link>}
      </form>
      <p className="mb-3 text-sm text-muted" role="status">{q ? t('resultCount', { count: employers.length, q }) : t('count', { count: employers.length })}</p>
      {employers.length === 0 ? <EmptyState title={t('noneTitle')} body={t('noneBody')} /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {employers.map((e) => {
            const aliases = e.employer_aliases.filter((a) => a.name_variant !== e.name_ar && a.name_variant !== e.name_en);
            return (
              <li key={e.id} className="card flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="subsection-title">
                    <Link href={`/employers/${e.id}`} className="hover:text-primary hover:underline hover:underline-offset-4">{pick(locale, e.name_ar, e.name_en)}</Link>
                  </h2>
                  <Badge tone={e.verification_status === 'verified_official' ? 'active' : 'warning'}>{status('status', e.verification_status)}</Badge>
                </div>
                <p className="text-sm text-muted">{pick(locale, e.name_en, e.name_ar)}</p>
                {e.match && (
                  <p className="text-sm">
                    {e.match.matched_by === 'alias'
                      ? t('matchedAlias', { alias: e.match.matched_text, status: status('aliasStatus', e.match.alias_status ?? '') })
                      : e.match.matched_by === 'company_id' ? t('matchedId', { id: e.match.matched_text }) : t('matchedName')}
                  </p>
                )}
                {aliases.length > 0 && (
                  <p className="text-sm"><span className="text-muted">{t('alsoKnownAs')}: </span>{aliases.map((a) => a.name_variant).join(locale === 'ar' ? '، ' : ', ')}</p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm">
                  <span className="text-muted">{status('partnership', e.partnership_status)}</span>
                  <span className="text-muted">{t('openJobs', { count: number(locale, e.open_jobs) })}</span>
                  <Link href={`/employers/${e.id}`} className="font-semibold text-primary underline underline-offset-4">{t('profile')}</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
