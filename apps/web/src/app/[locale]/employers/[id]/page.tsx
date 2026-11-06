import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatDate, pick } from '@/lib/format';

type Profile = {
  id: string; source_company_id: string; name_ar: string; name_en: string; entity_type: string | null; sector: string | null;
  official_website: string | null; career_url: string | null; verification_status: string; verification_source: string | null; partnership_status: string; notes: string | null;
  brand: { usable: boolean; identity_status: string | null; usage_permission: string | null; notes: string | null; logo_asset_url?: string | null; primary_hex?: string | null };
  aliases: { name_variant: string; language: string; alias_status: string; source_row: number | null; added_by_admin: boolean }[];
  sources: { source_url: string; source_type: string; checked_on: string | null; source_row: number | null }[];
  lineage: { source_file: string; source_sheet: string | null; source_row: number | null; brand_source_row: number | null; imported_at: string };
  jobs: { kind: 'midan' | 'external'; id: string; title_ar: string | null; title_en: string | null; title_original: string | null; location: string | null; source_name: string | null; source_url: string | null }[];
};

/** Everything here is as the official registry states it. A missing value is shown as missing, never filled in. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'employers' });
  const e = /^[0-9a-f-]{36}$/.test(id) ? await apiForPage<Profile>(`/reference/employers/${id}`) : null;
  if (!e) notFound();
  const status = (key: string, value: string | null) => (value && t.has(`${key}.${value}`) ? t(`${key}.${value}`) : value ?? t('notProvided'));
  const missing = <span className="text-muted">{t('notProvided')}</span>;
  const link = (url: string | null) => url ? <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all text-primary underline underline-offset-4">{url}</a> : missing;
  const official = e.aliases.filter((a) => a.alias_status === 'official');
  const others = e.aliases.filter((a) => a.alias_status !== 'official');
  const sourceText = (value: string | null) => value ? <span dir="ltr">{value}</span> : missing;
  return (
    <article className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/employers" className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>
      <header className="mt-4 flex flex-wrap items-start gap-4">
        {/* Midan's neutral identity unless the source establishes permission to use the employer's own. */}
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-7">
            <path d="M4 21V7l8-4 8 4v14M4 21h16M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01M8 13.5h.01M12 13.5h.01M16 13.5h.01" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{pick(locale, e.name_ar, e.name_en)}</h1>
          <p className="text-muted">{pick(locale, e.name_en, e.name_ar)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={e.verification_status === 'verified_official' ? 'active' : 'warning'}>{status('status', e.verification_status)}</Badge>
            <Badge>{status('partnership', e.partnership_status)}</Badge>
          </div>
        </div>
      </header>
      <p className="mt-4 border-s-2 border-gold ps-3 text-sm">{t('identityNote')}</p>

      <section aria-labelledby="identity" className="mt-8">
        <h2 id="identity" className="section-title">{t('identity')}</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div><dt className="text-sm text-muted">{t('officialNameAr')}</dt><dd>{e.name_ar}</dd></div>
          <div><dt className="text-sm text-muted">{t('officialNameEn')}</dt><dd dir="ltr" className="text-start">{e.name_en}</dd></div>
          <div><dt className="text-sm text-muted">{t('entityType')}</dt><dd>{sourceText(e.entity_type)}</dd></div>
          <div><dt className="text-sm text-muted">{t('sector')}</dt><dd>{sourceText(e.sector)}</dd></div>
          <div><dt className="text-sm text-muted">{t('website')}</dt><dd>{link(e.official_website)}</dd></div>
          <div><dt className="text-sm text-muted">{t('careers')}</dt><dd>{link(e.career_url)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-sm text-muted">{t('verificationSource')}</dt><dd>{link(e.verification_source)}</dd></div>
          {e.notes && <div className="sm:col-span-2"><dt className="text-sm text-muted">{t('sourceNotes')}</dt><dd dir="ltr" className="text-start">{e.notes}</dd></div>}
        </dl>
        <p className="mt-3 text-xs text-muted">{t('statedInEnglish')}</p>
      </section>

      <section aria-labelledby="names" className="mt-8">
        <h2 id="names" className="section-title">{t('names')}</h2>
        <p className="mt-1 text-sm text-muted">{t('namesLead')}</p>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {[...official, ...others].map((a) => (
            <li key={a.name_variant} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>{a.name_variant}</span>
              <Badge tone={a.alias_status === 'official' ? 'active' : a.alias_status.includes('review') ? 'warning' : 'neutral'}>{status('aliasStatus', a.alias_status)}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="brand" className="mt-8">
        <h2 id="brand" className="section-title">{t('brand')}</h2>
        <p className="mt-2">{e.brand.usable ? t('brandUsable') : t('brandNeutral')}</p>
        <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">{t('identityStatus')}</dt><dd>{status('brandStatus', e.brand.identity_status)}</dd></div>
          <div><dt className="text-muted">{t('usagePermission')}</dt><dd>{status('brandStatus', e.brand.usage_permission)}</dd></div>
          {e.brand.notes && <div className="sm:col-span-2"><dt className="text-muted">{t('brandNotes')}</dt><dd dir="ltr" className="text-start">{e.brand.notes}</dd></div>}
        </dl>
      </section>

      <section aria-labelledby="jobs" className="mt-8">
        <h2 id="jobs" className="section-title">{t('opportunities')}</h2>
        {e.jobs.length === 0 ? (
          <p className="mt-2 text-muted">{t('noJobs')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {e.jobs.map((j) => (
              <li key={`${j.kind}-${j.id}`} className="card flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{j.title_original ?? pick(locale, j.title_ar ?? '', j.title_en ?? '')}</span>
                  {j.location && <span className="text-muted"> · {j.location}</span>}
                </span>
                {j.kind === 'midan'
                  ? <Link href={`/opportunities/${j.id}`} className="text-sm font-semibold text-primary underline underline-offset-4">{t('viewJob')}</Link>
                  : <a href={j.source_url ?? '#'} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">{t('onSource', { source: j.source_name ?? '' })}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sources" className="mt-8">
        <h2 id="sources" className="section-title">{t('sources')}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {e.sources.map((s) => (
            <li key={s.source_url}>
              {link(s.source_url)}
              <span className="block text-muted">{status('sourceType', s.source_type)}{s.checked_on && ` · ${t('checkedOn', { date: formatDate(locale, s.checked_on, 'UTC') })}`}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          {t('lineage', { file: e.lineage.source_file, sheet: e.lineage.source_sheet ?? '', row: e.lineage.source_row ?? 0, id: e.source_company_id })}
        </p>
      </section>
    </article>
  );
}
