import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Guide } from '@/components/guide';
import { Icon } from '@/components/icons';
import { Badge, statusTone } from '@/components/ui';
import { LaneHeader, LaneTrack, Masthead, Segmented, STAGE_RANK } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatDate, number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type MyApplication = {
  id: string; status: string; created_at: string;
  jobs: { id: string; slug: string; title_ar: string; title_en: string; location: string | null; organizations: { slug: string; name_ar: string; name_en: string } };
  assessment_attempts: { id: string; status: string; assessment_versions: { id: string }; evaluation_results: { released_to_candidate: boolean } | null }[];
};

const CLOSED = ['withdrawn', 'rejected', 'hired'];

/** Every application, newest first: active ones as lanes from applying to the decision, each with the one thing to do next. */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/applications', locale });
  const applications = (await apiForPage<MyApplication[]>('/me/applications')) ?? [];
  const t = await getTranslations({ locale, namespace: 'myApplications' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const n = (v: number) => number(locale, v);
  const viewParam = (await searchParams).view;
  const view = viewParam === 'closed' ? 'closed' : 'active';
  const active = applications.filter((a) => !CLOSED.includes(a.status));
  const closed = applications.filter((a) => CLOSED.includes(a.status));
  const stations = td.raw('laneStages') as string[];

  const nextAction = (a: MyApplication) => {
    const open = a.assessment_attempts.find((x) => ['invited', 'in_progress'].includes(x.status));
    if (open && a.status !== 'withdrawn') return { label: open.status === 'invited' ? td('startAssessment') : td('continueAssessment'), href: `/experience/${a.jobs.organizations.slug}/${a.jobs.slug}/${open.assessment_versions.id}`, primary: true };
    const released = a.assessment_attempts.find((x) => x.evaluation_results?.released_to_candidate);
    if (released) return { label: td('viewReport'), href: `/reports/${released.id}`, primary: true };
    return null;
  };
  const note = (a: MyApplication) => a.status === 'shortlisted' ? td('lane.shortlisted') : a.assessment_attempts.some((x) => x.status === 'submitted') ? td('awaitingResults') : td('lane.withOrg');
  const meta = (a: MyApplication) => [pick(locale, a.jobs.organizations.name_ar, a.jobs.organizations.name_en), a.jobs.location, t('applied', { date: formatDate(locale, a.created_at, 'Asia/Riyadh') })].filter(Boolean).join(' · ');

  return (
    <section className="container-page space-y-8 py-8 lg:py-10">
      <Masthead eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')}>
        <Link href="/opportunities" className="btn btn-secondary btn-sm">{t('find')}</Link>
      </Masthead>

      {applications.length === 0 ? (
        <Guide title={t('emptyTitle')} action={<Link href="/opportunities" className="btn btn-primary btn-sm">{t('find')}</Link>}>{t('emptyBody')}</Guide>
      ) : (
        <>
          <Segmented label={t('views')} items={(['active', 'closed'] as const).map((key) => ({
            key, href: `/${locale}/applications?view=${key}`, current: view === key, label: t(`view.${key}`), count: n(key === 'active' ? active.length : closed.length),
          }))} />

          {view === 'active' ? (
            active.length === 0 ? <p className="rounded-[var(--radius-panel)] border border-dashed border-border-strong px-4 py-10 text-center text-muted">{t('none.active')}</p> : (
              <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
                <div className="hidden border-b border-border bg-surface-2/40 px-6 py-3 md:grid md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:gap-10">
                  <span className="text-xs font-semibold text-muted">{td('laneJob')}</span>
                  <LaneHeader stations={stations} />
                </div>
                <ol className="divide-y divide-border">
                  {active.map((a, i) => {
                    const at = STAGE_RANK[a.status] ?? 0;
                    const act = nextAction(a);
                    return (
                      <li key={a.id} className="px-5 py-6 sm:px-6">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-center md:gap-10">
                          <div className="min-w-0">
                            <Link href={`/applications/${a.id}`} className="line-clamp-2 font-display text-lg leading-snug font-bold hover:text-primary">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</Link>
                            <p className="mt-0.5 text-sm text-muted">{meta(a)}</p>
                          </div>
                          <div>
                            <LaneTrack status={a.status} stations={stations.length} delay={i * 90} label={td('laneAria', { stage: stations[at], n: n(at + 1), total: n(stations.length), status: ts(a.status) })} />
                            <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sm">
                              <span className="font-semibold">{ts(a.status)}</span>
                              <span className="text-muted md:hidden">{td('stageOf', { n: n(at + 1), total: n(stations.length) })}</span>
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3 md:ps-[calc(17rem+2.5rem)]">
                          {act ? <Link href={act.href} className="btn btn-primary btn-sm">{act.label}<Arrow /></Link>
                            : <span className="inline-flex items-center gap-1.5 text-sm text-muted"><Icon name="clock" className="size-4" />{note(a)}</span>}
                          <Link href={`/applications/${a.id}`} className="link ms-auto text-sm">{td('applicationDetails')}</Link>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )
          ) : closed.length === 0 ? <p className="rounded-[var(--radius-panel)] border border-dashed border-border-strong px-4 py-10 text-center text-muted">{t('none.closed')}</p> : (
            <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
              {closed.map((a) => {
                const act = nextAction(a);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <Link href={`/applications/${a.id}`} className="font-display text-lg font-bold hover:text-primary">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</Link>
                      <p className="text-sm text-muted">{meta(a)}</p>
                    </div>
                    <Badge tone={statusTone(a.status)}>{ts(a.status)}</Badge>
                    {act && a.status !== 'withdrawn' ? <Link href={act.href} className="btn btn-secondary btn-sm">{act.label}</Link> : <Link href={`/applications/${a.id}`} className="link text-sm">{td('applicationDetails')}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
