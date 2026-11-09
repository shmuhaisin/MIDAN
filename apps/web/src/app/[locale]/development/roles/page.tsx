import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { CareerTargetPicker } from '@/components/candidate';
import { Segmented } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { type Career, type Family, familyHref, normalize, SECTOR_KEYS } from '@/lib/career';
import { number } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Choosing a professional destination. The roles are the job families named in the sector skills workbooks, each with
 * the number of technical skills the workbook lists for it. They're families, not official job titles, and say so.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ sector?: string; q?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development/roles', locale });
  const query = await searchParams;
  const sector = SECTOR_KEYS.includes(query.sector as (typeof SECTOR_KEYS)[number]) ? query.sector! : '';
  const q = (query.q ?? '').trim().slice(0, 80);
  const [families, career] = await Promise.all([apiForPage<Family[]>('/reference/job-families'), apiForPage<Career>('/me/career')]);
  const t = await getTranslations({ locale, namespace: 'career' });
  const ts = await getTranslations({ locale, namespace: 'sectors' });
  const n = (v: number) => number(locale, v);
  const all = families ?? [];
  const needle = normalize(q);
  const shown = all.filter((f) => (!sector || f.sector_code === sector) && (!needle || normalize(f.job_family_ar).includes(needle)));
  const bySector = SECTOR_KEYS.map((key) => ({ key, items: shown.filter((f) => f.sector_code === key) })).filter((g) => g.items.length > 0);
  const target = career?.target ?? null;
  const isTarget = (f: Family) => target?.sector_code === f.sector_code && target?.job_family_ar === f.job_family_ar;
  const base = (next: { sector?: string; q?: string }) => {
    const p = new URLSearchParams();
    const s = next.sector ?? sector;
    const text = next.q ?? q;
    if (s) p.set('sector', s);
    if (text) p.set('q', text);
    const qs = p.toString();
    return `/${locale}/development/roles${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
        <div className="max-w-3xl">
          <p className="label-caps">{t('roles.eyebrow')}</p>
          <h1 className="display-lg mt-2 text-balance">{t('roles.title')}</h1>
          <p className="mt-3 leading-relaxed text-muted">{t('roles.lead')}</p>
        </div>
        <form action={`/${locale}/development/roles`} role="search" className="flex gap-2">
          {sector && <input type="hidden" name="sector" value={sector} />}
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('roles.search')}</span>
            <input name="q" defaultValue={q} dir="auto" placeholder={t('roles.searchPlaceholder')} className="input w-full" />
          </label>
          <button type="submit" className="btn btn-secondary">{t('roles.searchButton')}</button>
        </form>
      </header>

      <Segmented label={t('roles.sectors')} items={[
        { key: 'all', label: t('roles.allSectors'), href: base({ sector: '' }), current: !sector, count: n(all.filter((f) => !needle || normalize(f.job_family_ar).includes(needle)).length) },
        ...SECTOR_KEYS.map((key) => ({
          key, label: ts(key), href: base({ sector: key }), current: sector === key,
          count: n(all.filter((f) => f.sector_code === key && (!needle || normalize(f.job_family_ar).includes(needle))).length),
        })),
      ]} />

      {families === null ? <p role="alert" className="callout text-sm">{t('loadFailed')}</p>
        : shown.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-dashed border-border-strong px-6 py-12 text-center">
            <p className="font-display text-xl font-bold">{t('roles.noneTitle')}</p>
            <p className="mt-2 text-sm text-muted">{t('roles.noneBody')}</p>
            <a href={`/${locale}/development/roles`} className="btn btn-secondary btn-sm mt-5">{t('roles.clear')}</a>
          </div>
        ) : (
          <div className="space-y-10">
            {bySector.map((g) => (
              <section key={g.key} aria-labelledby={`sector-${g.key}`}>
                <div className="flex items-baseline justify-between gap-3 border-b border-border-strong pb-3">
                  <h2 id={`sector-${g.key}`} className="font-display text-2xl font-bold">{ts(g.key)}</h2>
                  <span className="num text-sm text-muted">{t('roles.familyCount', { count: g.items.length })}</span>
                </div>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.items.map((f) => (
                    <li key={f.job_family_ar}>
                      <Link href={familyHref(f.sector_code, f.job_family_ar)}
                        className={clsx('group flex h-full flex-col justify-between gap-4 rounded-[var(--radius-control)] border p-5 transition-colors',
                          isTarget(f) ? 'border-deep bg-deep text-deep-foreground on-deep' : 'border-border bg-surface hover:border-foreground/40')}>
                        <span className="font-display text-lg leading-snug font-bold" dir="rtl"><bdi>{f.job_family_ar}</bdi></span>
                        <span className="flex items-center justify-between gap-3 text-sm">
                          <span className={isTarget(f) ? 'text-deep-muted' : 'text-muted'}>
                            {isTarget(f) ? t('roles.current') : t('roles.skillCount', { count: f.skills })}
                          </span>
                          <Arrow className={clsx('transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5', isTarget(f) && 'text-gold')} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

      <section aria-labelledby="own-title" className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 sm:p-8">
        <h2 id="own-title" className="section-title">{t('roles.ownTitle')}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('roles.ownLead')}</p>
        <div className="mt-5"><CareerTargetPicker families={all} target={target} /></div>
      </section>

      <p className="text-xs text-muted">{t('source')}</p>
    </div>
  );
}
