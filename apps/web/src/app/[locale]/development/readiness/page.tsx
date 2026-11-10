import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Guide } from '@/components/guide';
import { type Readiness, ReadinessStart, ReadinessView } from '@/components/readiness';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Career readiness (مساري المهني): the candidate names the job they want, MIDAN's model writes what it requires and a short
 * practical assessment, MIDAN's matching model compares their own profile, and their answers are evaluated with a roadmap and
 * verified courses and certifications. Without a live model the page says so; nothing is shown in its place.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string; new?: string }> }) {
  const { locale } = await params;
  const { id, new: fresh } = await searchParams;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development/readiness', locale });
  const t = await getTranslations({ locale, namespace: 'readiness' });
  const [list, target] = await Promise.all([
    apiForPage<Readiness[]>('/me/career/readiness'),
    apiForPage<{ target: { job_title: string | null } | null }>('/me/career'),
  ]);
  const chosen = id ? await apiForPage<Readiness>(`/me/career/readiness/${id}`) : !fresh && list?.[0] ? await apiForPage<Readiness>(`/me/career/readiness/${list[0].id}`) : null;
  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      {list === null && <p role="alert" className="callout text-sm">{t('loadFailed')}</p>}
      {chosen ? (
        <>
          <ReadinessView data={chosen} />
          <p><Link href="/development/readiness?new=1" className="link text-sm">{t('another')}</Link></p>
        </>
      ) : (
        <>
          <header className="max-w-3xl">
            <p className="label-caps">{t('eyebrow')}</p>
            <h1 className="display-lg mt-2 text-balance">{t('title')}</h1>
            <p className="mt-3 leading-relaxed text-muted">{t('lead')}</p>
          </header>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8"><ReadinessStart initial={target?.target?.job_title ?? ''} /></section>
            <Guide title={t('guide.title')} outfit="original">{t('guide.body')}</Guide>
          </div>
        </>
      )}
      {list && list.length > 1 && (
        <section aria-labelledby="history">
          <h2 id="history" className="section-title">{t('history')}</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <Link href={`/development/readiness?id=${r.id}`} className="link" dir="auto">{pick(locale, r.plan.title_ar, r.plan.title_en)}</Link>
                <span className="num text-xs text-muted">{String(r.created_at).slice(0, 10)} · {t(`status.${r.status}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
