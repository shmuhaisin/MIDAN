import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Guide } from '@/components/guide';
import { Icon } from '@/components/icons';
import { Masthead } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatWhen, number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Attempt = {
  id: string; status: string; deadline_at: string | null; submitted_at?: string | null;
  assessment_versions: { id: string; assessments: { title_ar: string; title_en: string } };
  evaluation_results: { released_to_candidate: boolean } | null;
};
type MyApplication = {
  id: string; status: string;
  jobs: { slug: string; title_ar: string; title_en: string; organizations: { slug: string; name_ar: string; name_en: string } };
  assessment_attempts: Attempt[];
};

const DAY = 86400000;

/** Every practical assessment the candidate has been given: what needs them now first, then what is waiting or done. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/assessments', locale });
  const applications = (await apiForPage<MyApplication[]>('/me/applications')) ?? [];
  const t = await getTranslations({ locale, namespace: 'myAssessments' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const n = (v: number) => number(locale, v);
  const zone = 'Asia/Riyadh';
  const now = Date.now();
  const all = applications.filter((a) => a.status !== 'withdrawn').flatMap((a) => a.assessment_attempts.map((x) => ({ a, x })));
  const todo = all.filter(({ x }) => ['invited', 'in_progress'].includes(x.status))
    .sort((p, q) => (p.x.deadline_at ? Date.parse(p.x.deadline_at) : Infinity) - (q.x.deadline_at ? Date.parse(q.x.deadline_at) : Infinity));
  const groups = [
    ['waiting', all.filter(({ x }) => x.status === 'submitted' && !x.evaluation_results?.released_to_candidate), 'inbox'],
    ['results', all.filter(({ x }) => x.evaluation_results?.released_to_candidate), 'check'],
    ['closed', all.filter(({ x }) => x.status === 'expired'), 'close'],
  ] as const;
  const title = (x: Attempt) => pick(locale, x.assessment_versions.assessments.title_ar, x.assessment_versions.assessments.title_en);
  const where = (a: MyApplication) => `${pick(locale, a.jobs.title_ar, a.jobs.title_en)} · ${pick(locale, a.jobs.organizations.name_ar, a.jobs.organizations.name_en)}`;

  return (
    <section className="container-page space-y-10 py-8 lg:py-10">
      <Masthead eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      {all.length === 0 ? (
        <Guide title={t('emptyTitle')} action={<Link href="/opportunities" className="btn btn-primary btn-sm">{t('find')}</Link>}>{t('emptyBody')}</Guide>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
          <div className="min-w-0 space-y-10">
            {todo.length > 0 && (
              <section aria-labelledby="group-todo">
                <h2 id="group-todo" className="flex items-center gap-3 font-display text-xl font-bold">{t('group.todo')}<span className="num rounded-full bg-gold px-2.5 py-0.5 text-sm text-primary-foreground">{n(todo.length)}</span></h2>
                <p className="mt-1 text-sm text-muted">{t('groupLead.todo')}</p>
                <ul className="mt-5 grid gap-4 sm:grid-cols-2">
                  {todo.map(({ a, x }) => {
                    const left = x.deadline_at ? Math.max(0, Math.floor((Date.parse(x.deadline_at) - now) / DAY)) : null;
                    return (
                      <li key={x.id} className="flex flex-col rounded-[var(--radius-panel)] border border-border bg-surface p-5 shadow-[0_18px_40px_-34px_rgb(11_61_46/0.6)]">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs font-semibold text-gold-text">{x.status === 'invited' ? t('start') : t('continue')}</span>
                          {left !== null && <span className={clsx('num rounded-[3px] px-2 py-0.5 text-xs font-bold', left <= 2 ? 'bg-warning-surface text-warning' : 'bg-surface-2 text-muted')}>{td('daysLeft', { count: left, shown: n(left) })}</span>}
                        </div>
                        <p className="mt-2 font-display text-lg leading-snug font-bold">{title(x)}</p>
                        <p className="mt-1 text-sm text-muted">{where(a)}</p>
                        {x.deadline_at && <p className="mt-3 text-sm">{t('due', { date: formatWhen(locale, x.deadline_at, zone) })}</p>}
                        <div className="mt-5 flex-1" />
                        <Link href={`/experience/${a.jobs.organizations.slug}/${a.jobs.slug}/${x.assessment_versions.id}`} className="btn btn-primary btn-sm self-start">{x.status === 'invited' ? t('start') : t('continue')}<Arrow /></Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {groups.map(([key, items, icon]) => items.length > 0 && (
              <section key={key} aria-labelledby={`group-${key}`}>
                <h2 id={`group-${key}`} className="flex items-center gap-3 font-display text-xl font-bold">{t(`group.${key}`)}<span className="num rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-semibold text-muted">{n(items.length)}</span></h2>
                <p className="mt-1 text-sm text-muted">{t(`groupLead.${key}`)}</p>
                <ul className="mt-4 divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
                  {items.map(({ a, x }) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <span aria-hidden className={clsx('grid size-10 shrink-0 place-items-center rounded-full', key === 'results' ? 'bg-[color-mix(in_srgb,var(--brand-mint)_40%,transparent)] text-forest dark:text-mint' : 'bg-surface-2 text-muted')}><Icon name={icon} className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{title(x)}</span>
                        <span className="block text-sm text-muted">{where(a)}</span>
                      </span>
                      {key === 'results' ? <Link href={`/reports/${x.id}`} className="btn btn-primary btn-sm">{t('viewResults')}</Link>
                        : <Link href={`/applications/${a.id}`} className="link text-sm">{t('application')}</Link>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <Guide title={t('howTitle')}>
              <ol className="mt-1 space-y-1.5">
                {(t.raw('how') as string[]).map((line, i) => <li key={line} className="flex gap-2"><span className="num font-semibold text-gold-text">{n(i + 1)}</span>{line}</li>)}
              </ol>
            </Guide>
          </aside>
        </div>
      )}
    </section>
  );
}
