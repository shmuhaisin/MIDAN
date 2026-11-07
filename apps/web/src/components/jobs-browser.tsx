'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { formatDate, number, pick } from '@/lib/format';
import { Arrow } from './brand';
import { Badge, EmptyState } from './ui';

export type PublicJob = {
  id: string; title_ar: string; title_en: string; location: string | null; is_demo: boolean;
  organizations: { name_ar: string; name_en: string };
  sector: string | null; employment_type: string | null; experience_level: string | null; application_deadline: string | null;
  job_skills: { skills: { id: string; name_ar: string; name_en: string } }[];
  job_reference_skills: { reference_skills: { id: string; name_ar: string } }[];
};

export type ExternalListing = {
  id: string; title_original: string | null; title_ar: string | null; title_en: string | null; employer_name_ar: string | null; employer_name_en: string | null; location: string | null;
  source_name: string; source_url: string; employer_registry: { name_ar: string; name_en: string } | null;
};

const SECTORS = ['digital', 'culture_entertainment', 'tourism_hospitality', 'manufacturing', 'construction_real_estate', 'financial_services', 'wholesale_retail'];
const CONTROL = 'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary disabled:opacity-60';

function FilterSelect({ label, all, value, onChange, options }: { label: string; all: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select value={value} disabled={options.length === 0} onChange={(e) => onChange(e.target.value)} className={CONTROL}>
        <option value="">{all}</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

function JobCard({ job }: { job: PublicJob }) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const skills = [
    ...job.job_skills.map((s) => ({ id: s.skills.id, name: pick(locale, s.skills.name_ar, s.skills.name_en) })),
    ...job.job_reference_skills.map((s) => ({ id: s.reference_skills.id, name: s.reference_skills.name_ar })),
  ];
  const facts = [job.location, job.employment_type && t(`employment.${job.employment_type}`), job.experience_level && t(`level.${job.experience_level}`)].filter(Boolean);
  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="subsection-title"><Link href={`/opportunities/${job.id}`} className="hover:text-primary">{pick(locale, job.title_ar, job.title_en)}</Link></h2>
          <p className="text-sm text-muted">{pick(locale, job.organizations.name_ar, job.organizations.name_en)}</p>
        </div>
        {job.is_demo && <Badge tone="warning">{t('demo')}</Badge>}
      </div>
      {facts.length > 0 && <p className="mt-2 text-sm">{facts.join(' · ')}</p>}
      {skills.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {skills.slice(0, 5).map((s) => <li key={s.id}><Badge tone="active">{s.name}</Badge></li>)}
          {skills.length > 5 && <li><Badge>+{number(locale, skills.length - 5)}</Badge></li>}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted">{job.application_deadline && t('deadline', { date: formatDate(locale, job.application_deadline, 'UTC') })}</span>
        <Link href={`/opportunities/${job.id}`} aria-label={t('viewDetailsOf', { job: pick(locale, job.title_ar, job.title_en) })} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">{t('viewDetails')}<Arrow /></Link>
      </div>
    </li>
  );
}

export type JobsResult = {
  items: PublicJob[]; total: number; page: number; page_size: number;
  facets: { locations: string[]; employment_types: string[]; experience_levels: string[]; employers: { name_ar: string; name_en: string }[] };
};
export type ListingsResult = { items: ExternalListing[]; total: number; page: number; page_size: number };
export type JobFilters = { q: string; employer: string; sector: string; location: string; employment_type: string; experience_level: string };

/** The address for these filters. Changing a filter goes back to the first page. */
function hrefFor(filters: JobFilters, demo: boolean, pages: { page?: number; xpage?: number } = {}) {
  const params = new URLSearchParams();
  if (demo) params.set('demo', '1');
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (pages.page && pages.page > 1) params.set('page', String(pages.page));
  if (pages.xpage && pages.xpage > 1) params.set('xpage', String(pages.xpage));
  const query = params.toString();
  return `/opportunities${query ? `?${query}` : ''}`;
}

function Pages({ page, pageSize, total, label, href }: { page: number; pageSize: number; total: number; label: string; href: (page: number) => string }) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last === 1) return null;
  return (
    <nav aria-label={label} className="mt-5 flex flex-wrap items-center justify-center gap-4 text-sm">
      {page > 1 ? <Link href={href(page - 1)} rel="prev" className="font-semibold text-primary underline underline-offset-4">{t('prevPage')}</Link> : <span className="text-muted">{t('prevPage')}</span>}
      <span aria-current="page">{t('pageOf', { page: number(locale, page), last: number(locale, last) })}</span>
      {page < last ? <Link href={href(page + 1)} rel="next" className="font-semibold text-primary underline underline-offset-4">{t('nextPage')}</Link> : <span className="text-muted">{t('nextPage')}</span>}
    </nav>
  );
}

export function JobsBrowser({ result, external, filters, demo = false }: { result: JobsResult; external?: ListingsResult; filters: JobFilters; demo?: boolean }) {
  const t = useTranslations('jobs');
  const ts = useTranslations('sectors');
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState(filters.q);
  const go = (next: Partial<JobFilters>) => router.replace(hrefFor({ ...filters, ...next }, demo), { scroll: false });
  // The search follows typing, after a short pause. The address holds it, so a result can be shared or reopened.
  useEffect(() => {
    if (query.trim() === filters.q) return;
    const timer = setTimeout(() => go({ q: query.trim() }), 300);
    return () => clearTimeout(timer);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setQuery(filters.q), [filters.q]);

  const filtering = Object.values(filters).some(Boolean);
  const clear = () => {
    setQuery('');
    router.replace(hrefFor({ q: '', employer: '', sector: '', location: '', employment_type: '', experience_level: '' }, demo), { scroll: false });
  };
  const { items, total, page, page_size: pageSize, facets } = result;

  if (!filtering && total === 0) {
    return (
      <EmptyState title={t('noneTitle')} body={t('noneBody')}>
        <Link href="/employers" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2 font-semibold text-primary-foreground">{t('browseEmployers')}</Link>
        <Link href="/opportunities?demo=1" className="text-sm font-semibold underline underline-offset-4">{t('seeDemo')}</Link>
      </EmptyState>
    );
  }

  return (
    <div>
      <form role="search" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); go({ q: query.trim() }); }}>
        <label className="block sm:col-span-2 lg:col-span-6">
          <span className="sr-only">{t('search')}</span>
          <input type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} className={CONTROL} />
        </label>
        <FilterSelect label={t('employerWithJobs')} all={t('allEmployers')} value={filters.employer} onChange={(employer) => go({ employer })} options={facets.employers.map((o) => [o.name_en, pick(locale, o.name_ar, o.name_en)])} />
        <FilterSelect label={t('sector')} all={t('allSectors')} value={filters.sector} onChange={(sector) => go({ sector })} options={SECTORS.map((k) => [k, ts(k)])} />
        <FilterSelect label={t('location')} all={t('allLocations')} value={filters.location} onChange={(location) => go({ location })} options={facets.locations.map((c) => [c, c])} />
        <FilterSelect label={t('employmentType')} all={t('allTypes')} value={filters.employment_type} onChange={(employment_type) => go({ employment_type })} options={facets.employment_types.map((k) => [k, t(`employment.${k}`)])} />
        <FilterSelect label={t('experienceLevel')} all={t('allLevels')} value={filters.experience_level} onChange={(experience_level) => go({ experience_level })} options={facets.experience_levels.map((k) => [k, t(`level.${k}`)])} />
        <div className="flex items-end">
          <button type="button" disabled={!filtering && !query} onClick={clear} className="h-11 w-full rounded-lg border border-border text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">{t('clearFilters')}</button>
        </div>
      </form>
      <p aria-live="polite" className="mt-4 text-sm text-muted">{t('count', { count: total, shown: number(locale, total) })}</p>
      {items.length === 0 ? (
        <div className="mt-3"><EmptyState title={t('emptyTitle')} body={t('emptyBody')}><button type="button" onClick={clear} className="font-semibold text-primary underline underline-offset-4">{t('clearFilters')}</button></EmptyState></div>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">{items.map((job) => <JobCard key={job.id} job={job} />)}</ul>
      )}
      <Pages page={page} pageSize={pageSize} total={total} label={t('jobPages')} href={(n) => hrefFor(filters, demo, { page: n, xpage: external?.page })} />
      {demo && <p className="mt-6 text-sm"><Link href="/opportunities" className="font-semibold underline underline-offset-4">{t('backToReal')}</Link></p>}
      {external && external.items.length > 0 && (
        <section aria-labelledby="external" className="mt-8">
          <h2 id="external" className="section-title">{t('externalTitle')}</h2>
          <p className="text-sm text-muted">{t('externalNote')}</p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {external.items.map((job) => (
              <li key={job.id} className="card">
                <a href={job.source_url} target="_blank" rel="noopener noreferrer" className="block hover:text-primary">
                  <span dir="auto" className="subsection-title block">{job.title_original ?? pick(locale, job.title_ar ?? '', job.title_en ?? '')}</span>
                  <span className="text-sm text-muted">
                    {pick(locale, job.employer_registry?.name_ar ?? job.employer_name_ar ?? '', job.employer_registry?.name_en ?? job.employer_name_en ?? '')}{job.location && ` · ${job.location}`} · {t('externalSource', { source: job.source_name })}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <Pages page={external.page} pageSize={external.page_size} total={external.total} label={t('listingPages')} href={(n) => hrefFor(filters, demo, { page, xpage: n })} />
        </section>
      )}
    </div>
  );
}
