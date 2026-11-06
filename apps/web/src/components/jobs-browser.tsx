'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
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
  id: string; title_ar: string; title_en: string; employer_name_ar: string | null; employer_name_en: string | null; location: string | null; source_name: string; source_url: string; is_demo: boolean;
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

export function JobsBrowser({ jobs, external = [], demo = false }: { jobs: PublicJob[]; external?: ExternalListing[]; demo?: boolean }) {
  const t = useTranslations('jobs');
  const ts = useTranslations('sectors');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [employer, setEmployer] = useState('');
  const [sector, setSector] = useState('');
  const [employment, setEmployment] = useState('');
  const [level, setLevel] = useState('');
  const cities = useMemo(() => [...new Set(jobs.map((j) => j.location).filter(Boolean))] as string[], [jobs]);
  const employers = useMemo(() => [...new Map(jobs.map((j) => [j.organizations.name_en, j.organizations])).values()], [jobs]);
  const present = (key: 'employment_type' | 'experience_level') => [...new Set(jobs.map((j) => j[key]).filter(Boolean))] as string[];
  const needle = query.trim().toLowerCase();
  const filtering = Boolean(needle || city || employer || sector || employment || level);
  const shown = jobs.filter((j) =>
    (!city || j.location === city) && (!employer || j.organizations.name_en === employer) && (!sector || j.sector === sector) &&
    (!employment || j.employment_type === employment) && (!level || j.experience_level === level) &&
    (!needle || [j.title_ar, j.title_en, j.organizations.name_ar, j.organizations.name_en].some((v) => v.toLowerCase().includes(needle))),
  );
  const clear = () => { setQuery(''); setCity(''); setEmployer(''); setSector(''); setEmployment(''); setLevel(''); };

  if (jobs.length === 0) {
    return (
      <EmptyState title={t('noneTitle')} body={t('noneBody')}>
        <Link href="/employers" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2 font-semibold text-primary-foreground">{t('browseEmployers')}</Link>
        <Link href="/opportunities?demo=1" className="text-sm font-semibold underline underline-offset-4">{t('seeDemo')}</Link>
      </EmptyState>
    );
  }

  return (
    <div>
      <form role="search" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()}>
        <label className="block sm:col-span-2 lg:col-span-6">
          <span className="sr-only">{t('search')}</span>
          <input type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} className={CONTROL} />
        </label>
        <FilterSelect label={t('employerWithJobs')} all={t('allEmployers')} value={employer} onChange={setEmployer} options={employers.map((o) => [o.name_en, pick(locale, o.name_ar, o.name_en)])} />
        <FilterSelect label={t('sector')} all={t('allSectors')} value={sector} onChange={setSector} options={SECTORS.map((k) => [k, ts(k)])} />
        <FilterSelect label={t('location')} all={t('allLocations')} value={city} onChange={setCity} options={cities.map((c) => [c, c])} />
        <FilterSelect label={t('employmentType')} all={t('allTypes')} value={employment} onChange={setEmployment} options={present('employment_type').map((k) => [k, t(`employment.${k}`)])} />
        <FilterSelect label={t('experienceLevel')} all={t('allLevels')} value={level} onChange={setLevel} options={present('experience_level').map((k) => [k, t(`level.${k}`)])} />
        <div className="flex items-end">
          <button type="button" disabled={!filtering} onClick={clear} className="h-11 w-full rounded-lg border border-border text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">{t('clearFilters')}</button>
        </div>
      </form>
      <p aria-live="polite" className="mt-4 text-sm text-muted">{t('count', { count: shown.length, shown: number(locale, shown.length) })}</p>
      {shown.length === 0 ? (
        <div className="mt-3"><EmptyState title={t('emptyTitle')} body={t('emptyBody')}><button type="button" onClick={clear} className="font-semibold text-primary underline underline-offset-4">{t('clearFilters')}</button></EmptyState></div>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">{shown.map((job) => <JobCard key={job.id} job={job} />)}</ul>
      )}
      {demo && <p className="mt-6 text-sm"><Link href="/opportunities" className="font-semibold underline underline-offset-4">{t('backToReal')}</Link></p>}
      {external.length > 0 && (
        <section aria-labelledby="external" className="mt-8">
          <h2 id="external" className="section-title">{t('externalTitle')}</h2>
          <p className="text-sm text-muted">{t('externalNote')}</p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {external.map((job) => (
              <li key={job.id} className="card">
                <a href={job.source_url} target="_blank" rel="noopener noreferrer" className="block hover:text-primary">
                  <span className="subsection-title block">{pick(locale, job.title_ar, job.title_en)}</span>
                  <span className="text-sm text-muted">{pick(locale, job.employer_name_ar ?? '', job.employer_name_en ?? '')}{job.location && ` · ${job.location}`} · {t('onSource', { source: job.source_name })}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
