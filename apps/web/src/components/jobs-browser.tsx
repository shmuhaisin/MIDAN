'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { deadlineState } from '@/lib/deadline';
import { formatDate, number, pick } from '@/lib/format';
import { Arrow } from './brand';
import { Icon } from './icons';
import { SaveJobButton } from './save-job';
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
const CONTROL = 'input mt-0 text-sm';

function FilterSelect({ label, all, value, onChange, options }: { label: string; all: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <select value={value} disabled={options.length === 0} onChange={(e) => onChange(e.target.value)} className={`${CONTROL} mt-1.5`}>
        <option value="">{all}</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

/** The deadline, and whether applications are closing soon or closed (Riyadh date, inclusive). */
export function DeadlineNote({ deadline }: { deadline: string | null }) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const state = deadlineState(deadline);
  if (!deadline || !state) return null;
  const date = formatDate(locale, deadline, 'UTC');
  if (state === 'closed') return <Badge tone="neutral">{t('closedOn', { date })}</Badge>;
  if (state === 'closing_soon') return <Badge tone="warning">{t('closingSoon', { date })}</Badge>;
  return <span className="text-sm text-muted">{t('deadline', { date })}</span>;
}

const MONO = ['bg-forest text-ivory', 'bg-accent text-accent-foreground', 'bg-brand-gold text-forest'];

/** One opportunity as a row of the index: who, what, the facts, the skills, and the deadline. */
function JobRow({ job, index, saved }: { job: PublicJob; index: number; saved: boolean | null }) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const skills = [
    ...job.job_skills.map((s) => ({ id: s.skills.id, name: pick(locale, s.skills.name_ar, s.skills.name_en) })),
    ...job.job_reference_skills.map((s) => ({ id: s.reference_skills.id, name: s.reference_skills.name_ar })),
  ];
  const facts = [job.location, job.employment_type && t(`employment.${job.employment_type}`), job.experience_level && t(`level.${job.experience_level}`)].filter(Boolean);
  const title = pick(locale, job.title_ar, job.title_en);
  const org = pick(locale, job.organizations.name_ar, job.organizations.name_en);
  return (
    <li className="group relative grid gap-4 px-4 py-6 transition-colors hover:bg-surface-2/50 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-5 sm:px-6">
      <span aria-hidden className="absolute inset-y-4 start-0 w-0.5 origin-top scale-y-0 bg-gold transition-transform duration-300 group-hover:scale-y-100" />
      <span aria-hidden className={`grid size-12 place-items-center rounded-[var(--radius-panel)] font-display text-lg font-bold ${MONO[index % 3]}`}>{org.trim().charAt(0)}</span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-semibold text-foreground">{org}</span>
          {job.is_demo && <Badge tone="warning">{t('demo')}</Badge>}
        </p>
        <h2 className="mt-1 font-display text-xl leading-snug font-bold sm:text-[1.375rem]">
          <Link href={`/opportunities/${job.id}`} aria-label={t('viewDetailsOf', { job: title })} className="after:absolute after:inset-0 group-hover:text-primary">{title}</Link>
        </h2>
        {facts.length > 0 && <p className="mt-1.5 text-sm text-muted">{facts.join(' · ')}</p>}
        {skills.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {skills.slice(0, 5).map((s) => <li key={s.id} className="rounded-[3px] bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{s.name}</li>)}
            {skills.length > 5 && <li className="rounded-[3px] bg-surface-2 px-2 py-0.5 text-xs font-medium">+{number(locale, skills.length - 5)}</li>}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-between">
        <span className="flex flex-col items-end gap-2">
          <DeadlineNote deadline={job.application_deadline} />
          {saved !== null && <SaveJobButton jobId={job.id} title={title} saved={saved} compact />}
        </span>
        <span aria-hidden className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          {t('viewDetails')}<Arrow className="transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
        </span>
      </div>
    </li>
  );
}

export type JobsResult = {
  items: PublicJob[]; total: number; page: number; page_size: number;
  facets: { locations: string[]; employment_types: string[]; experience_levels: string[]; employers: { name_ar: string; name_en: string }[] };
};
export type ListingsResult = { items: ExternalListing[]; total: number; page: number; page_size: number };
export type JobFilters = { q: string; employer: string; sector: string; location: string; employment_type: string; experience_level: string; sort: string };

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
    <nav aria-label={label} className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm">
      {page > 1 ? <Link href={href(page - 1)} rel="prev" className="btn btn-secondary btn-sm"><Icon name="chevron" className="size-4 rotate-180" />{t('prevPage')}</Link> : <span aria-disabled="true" className="btn btn-secondary btn-sm">{t('prevPage')}</span>}
      <span aria-current="page" className="num font-medium">{t('pageOf', { page: number(locale, page), last: number(locale, last) })}</span>
      {page < last ? <Link href={href(page + 1)} rel="next" className="btn btn-secondary btn-sm">{t('nextPage')}<Icon name="chevron" className="size-4" /></Link> : <span aria-disabled="true" className="btn btn-secondary btn-sm">{t('nextPage')}</span>}
    </nav>
  );
}

export function JobsBrowser({ result, external, filters, demo = false, savedIds = null, savedView = false }: {
  result: JobsResult; external?: ListingsResult; filters: JobFilters; demo?: boolean;
  /** The candidate's saved job ids; null when the visitor isn't a signed-in candidate (no save buttons). */
  savedIds?: string[] | null; savedView?: boolean;
}) {
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

  const filtering = Object.entries(filters).some(([key, value]) => key !== 'sort' && Boolean(value));
  const savedSet = savedIds ? new Set(savedIds) : null;
  const clear = () => {
    setQuery('');
    router.replace(hrefFor({ q: '', employer: '', sector: '', location: '', employment_type: '', experience_level: '', sort: filters.sort }, demo), { scroll: false });
  };
  const { items, total, page, page_size: pageSize, facets } = result;

  if (savedView) {
    return (
      <div className="space-y-4">
        <p className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{t('savedCount', { count: items.length, shown: number(locale, items.length) })}</span>
          <Link href="/opportunities" className="link">{t('allJobs')}</Link>
        </p>
        {items.length === 0 ? (
          <EmptyState title={t('savedEmptyTitle')} body={t('savedEmptyBody')}><Link href="/opportunities" className="btn btn-primary btn-sm">{t('allJobs')}</Link></EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
            {items.map((job, i) => <JobRow key={job.id} job={job} index={i} saved={savedSet ? savedSet.has(job.id) : null} />)}
          </ul>
        )}
      </div>
    );
  }

  if (!filtering && total === 0) {
    return (
      <EmptyState title={t('noneTitle')} body={t('noneBody')}>
        <Link href="/employers" className="btn btn-primary">{t('browseEmployers')}</Link>
        <Link href="/opportunities?demo=1" className="btn btn-secondary">{t('seeDemo')}</Link>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <form role="search" method="get" className="space-y-4 lg:sticky lg:top-28 lg:self-start" onSubmit={(e) => { e.preventDefault(); go({ q: query.trim() }); }}>
        {demo && <input type="hidden" name="demo" value="1" />}
        <label className="relative block">
          <span className="sr-only">{t('search')}</span>
          <Icon name="search" className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input type="search" name="q" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} className={`${CONTROL} min-h-12 ps-10 text-base`} />
        </label>
        <div className="grid gap-4 rounded-[var(--radius-panel)] border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-1">
          <FilterSelect label={t('employerWithJobs')} all={t('allEmployers')} value={filters.employer} onChange={(employer) => go({ employer })} options={facets.employers.map((o) => [o.name_en, pick(locale, o.name_ar, o.name_en)])} />
          <FilterSelect label={t('sector')} all={t('allSectors')} value={filters.sector} onChange={(sector) => go({ sector })} options={SECTORS.map((k) => [k, ts(k)])} />
          <FilterSelect label={t('location')} all={t('allLocations')} value={filters.location} onChange={(location) => go({ location })} options={facets.locations.map((c) => [c, c])} />
          <FilterSelect label={t('employmentType')} all={t('allTypes')} value={filters.employment_type} onChange={(employment_type) => go({ employment_type })} options={facets.employment_types.map((k) => [k, t(`employment.${k}`)])} />
          <FilterSelect label={t('experienceLevel')} all={t('allLevels')} value={filters.experience_level} onChange={(experience_level) => go({ experience_level })} options={facets.experience_levels.map((k) => [k, t(`level.${k}`)])} />
          <FilterSelect label={t('sortLabel')} all={t('sortNewest')} value={filters.sort} onChange={(sort) => go({ sort })} options={[['deadline', t('sortDeadline')]]} />
          <button type="button" disabled={!filtering && !query} onClick={clear} className="btn btn-ghost btn-sm sm:col-span-2 lg:col-span-1">{t('clearFilters')}</button>
          {savedSet && <Link href="/opportunities?saved=1" className="link text-sm sm:col-span-2 lg:col-span-1">{t('savedLink', { count: savedSet.size, shown: number(locale, savedSet.size) })}</Link>}
        </div>
      </form>

      <div className="min-w-0">
        <p aria-live="polite" className="mb-3 flex items-center gap-3 text-sm text-muted">
          <span aria-hidden className="h-px w-6 bg-gold" />
          {t('count', { count: total, shown: number(locale, total) })}
        </p>
        {items.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')}><button type="button" onClick={clear} className="btn btn-secondary btn-sm">{t('clearFilters')}</button></EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">{items.map((job, i) => <JobRow key={job.id} job={job} index={i} saved={savedSet ? savedSet.has(job.id) : null} />)}</ul>
        )}
        <Pages page={page} pageSize={pageSize} total={total} label={t('jobPages')} href={(n) => hrefFor(filters, demo, { page: n, xpage: external?.page })} />
        {demo && <p className="mt-6 text-sm"><Link href="/opportunities" className="link">{t('backToReal')}</Link></p>}
        {external && external.items.length > 0 && (
          <section aria-labelledby="external" className="mt-14">
            <div className="border-b border-border-strong pb-3">
              <h2 id="external" className="section-title">{t('externalTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('externalNote')}</p>
            </div>
            <ul className="divide-y divide-border">
              {external.items.map((job) => (
                <li key={job.id}>
                  <a href={job.source_url} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-4 py-4 hover:text-primary">
                    <span className="min-w-0">
                      <span dir="auto" className="block font-semibold">{job.title_original ?? pick(locale, job.title_ar ?? '', job.title_en ?? '')}</span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {pick(locale, job.employer_registry?.name_ar ?? job.employer_name_ar ?? '', job.employer_registry?.name_en ?? job.employer_name_en ?? '')}{job.location && ` · ${job.location}`} · {t('externalSource', { source: job.source_name })}
                      </span>
                    </span>
                    <Icon name="external" className="mt-1 size-4 shrink-0 text-muted group-hover:text-primary" />
                  </a>
                </li>
              ))}
            </ul>
            <Pages page={external.page} pageSize={external.page_size} total={external.total} label={t('listingPages')} href={(n) => hrefFor(filters, demo, { page, xpage: n })} />
          </section>
        )}
      </div>
    </div>
  );
}
