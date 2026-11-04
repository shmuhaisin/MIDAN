'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';
import { Arrow, Humaidan } from './brand';

export type PublicJob = {
  id: string; title_ar: string; title_en: string; location: string | null; is_demo: boolean;
  organizations: { name_ar: string; name_en: string };
};

export function JobsBrowser({ jobs }: { jobs: PublicJob[] }) {
  const t = useTranslations('jobs');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const cities = useMemo(() => [...new Set(jobs.map((j) => j.location).filter(Boolean))] as string[], [jobs]);
  const needle = query.trim().toLowerCase();
  const shown = jobs.filter((j) =>
    (!city || j.location === city) &&
    (!needle || [j.title_ar, j.title_en, j.organizations.name_ar, j.organizations.name_en].some((v) => v.toLowerCase().includes(needle))),
  );

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="w-28"><Humaidan sizes="112px" /></div>
        <p className="mt-4 font-display text-xl font-semibold">{t('noneTitle')}</p>
        <p className="mt-1 text-muted">{t('noneBody')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label>
          <span className="sr-only">{t('search')}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} className="h-12 w-full rounded-full border border-border bg-surface px-5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25" />
        </label>
        <label>
          <span className="sr-only">{t('location')}</span>
          <select value={city} onChange={(e) => setCity(e.target.value)} className="h-12 w-full rounded-full border border-border bg-surface px-5 sm:w-48">
            <option value="">{t('allLocations')}</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <p aria-live="polite" className="mt-4 text-sm text-muted">{t('count', { count: shown.length, shown: number(locale, shown.length) })}</p>

      {shown.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-display text-xl font-semibold">{t('emptyTitle')}</p>
          <p className="mt-1 text-muted">{t('emptyBody')}</p>
          <button type="button" onClick={() => { setQuery(''); setCity(''); }} className="mt-4 font-semibold text-primary underline underline-offset-4">{t('clear')}</button>
        </div>
      ) : (
        <ul className="mt-3 border-t border-border">
          <AnimatePresence initial={false}>
            {shown.map((job) => (
              <motion.li key={job.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="border-b border-border">
                <Link href={`/opportunities/${job.id}`} className="group flex items-center gap-4 py-5 transition-colors hover:text-primary">
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-xl font-semibold sm:text-2xl">{pick(locale, job.title_ar, job.title_en)}</span>
                    <span className="mt-1 block text-sm text-muted">
                      {pick(locale, job.organizations.name_ar, job.organizations.name_en)}{job.location && ` · ${job.location}`}
                    </span>
                  </span>
                  {job.is_demo && <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">{t('demo')}</span>}
                  <Arrow className="transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                </Link>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
