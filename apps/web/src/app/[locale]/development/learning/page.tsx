import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { PlanItemControls, SavePlanButton } from '@/components/candidate';
import { Guide } from '@/components/guide';
import { Icon } from '@/components/icons';
import { Panel, Segmented } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { ACTIVITY_KINDS, type Career, EMPTY_CAREER, hasTarget, type PlanItem, resourcesOf } from '@/lib/career';
import { formatDate, number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Learning for the target role: verified resources for the role's skills, each with the skill it develops and why it's
 * here, and the candidate's planned activities of the four kinds, by status. Progress is what the candidate reports;
 * it verifies neither a course nor a certificate.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?next=/development/learning', locale });
  const kindParam = (await searchParams).kind;
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(kindParam ?? '') ? kindParam as PlanItem['kind'] : null;
  const career = await apiForPage<Career>('/me/career');
  const t = await getTranslations({ locale, namespace: 'career' });
  const td = await getTranslations({ locale, namespace: 'development' });
  const data = career ?? EMPTY_CAREER;
  const n = (v: number) => number(locale, v);
  const resources = resourcesOf(data);
  const title = (r: { title_ar: string | null; title_en: string | null }) => pick(locale, r.title_ar ?? r.title_en ?? '', r.title_en ?? r.title_ar ?? '');
  const inPlan = (skill: string, k: string, resource: string) => data.plan.some((p) => p.reference_skills.id === skill && p.kind === k && p.learning_resources?.id === resource);
  const plan = kind ? data.plan.filter((p) => p.kind === kind) : data.plan;
  const columns = (['not_started', 'in_progress', 'completed'] as const).map((status) => ({ status, items: plan.filter((p) => p.status === status) }));
  const label = (p: PlanItem) => p.learning_resources ? title(p.learning_resources) : td(`kind.${p.kind}`, { skill: p.reference_skills.name_ar });

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <header className="max-w-3xl">
        <p className="label-caps">{t('learning.eyebrow')}</p>
        <h1 className="display-lg mt-2 text-balance">{t('learning.title')}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t('learning.lead')}</p>
      </header>

      {career === null && <p role="alert" className="callout text-sm">{t('loadFailed')}</p>}

      <section aria-labelledby="plan-board">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="plan-board" className="section-title">{td('planTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{td('planNote')}</p>
          </div>
          {/* min-w-0: in a flex row the switcher may shrink and scroll in its own strip instead of widening the page. */}
          <div className="min-w-0 max-w-full"><Segmented label={t('learning.kinds')} items={[
            { key: 'all', label: t('learning.allKinds'), href: `/${locale}/development/learning`, current: !kind, count: n(data.plan.length) },
            ...ACTIVITY_KINDS.map((k) => ({ key: k, label: t(`learning.kind.${k}`), href: `/${locale}/development/learning?kind=${k}`, current: kind === k, count: n(data.plan.filter((p) => p.kind === k).length) })),
          ]} /></div>
        </div>
        {data.plan.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-panel)] border border-dashed border-border-strong px-6 py-10 text-center text-muted">{td('planEmpty')}</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {columns.map((c) => (
              <div key={c.status} className="rounded-[var(--radius-panel)] border border-border bg-surface-2/40 p-3">
                <p className="flex items-center justify-between px-2 pt-1 pb-3 text-sm font-semibold">
                  {td(`status.${c.status}`)}<span className="num text-muted">{n(c.items.length)}</span>
                </p>
                {c.items.length === 0 ? <p className="px-2 pb-3 text-sm text-muted">{t('learning.columnEmpty')}</p> : (
                  <ul className="space-y-2">
                    {c.items.map((p) => (
                      <li key={p.id} className="rounded-[var(--radius-control)] border border-border bg-surface p-4">
                        <p className="text-xs font-semibold text-gold-text">{t(`learning.kind.${p.kind}`)}</p>
                        <p className="mt-1 font-semibold leading-snug">{label(p)}</p>
                        <p className="mt-1 text-xs text-muted" dir="auto">{t('learning.forSkill', { skill: p.reference_skills.name_ar })}</p>
                        {p.learning_resources && (
                          <a href={p.learning_resources.url} target="_blank" rel="noopener noreferrer" className="link mt-2 inline-flex items-center gap-1 text-sm">
                            {p.learning_resources.provider}<Icon name="external" className="size-3.5" /><span className="sr-only">{t('learning.newTab')}</span>
                          </a>
                        )}
                        <div className="mt-3"><PlanItemControls id={p.id} status={p.status} label={label(p)} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {!hasTarget(data) ? (
        <Guide title={t('start.title')} action={<Link href="/development/roles" className="btn btn-primary btn-sm">{t('start.action')}<Arrow /></Link>}>{t('start.body')}</Guide>
      ) : (
        <Panel id="resources" title={t('learning.resourcesTitle')} lead={t('learning.resourcesLead')} count={n(resources.length)} flush>
          {resources.length === 0 ? (
            <p className="px-6 py-6 text-sm leading-relaxed text-muted lg:px-8">{td('noCatalog')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {resources.map(({ resource: r, skill }) => (
                <li key={`${skill.id}-${r.id}`} className="grid gap-3 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-8">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gold-text">{t(`learning.kind.${r.kind}`)} · {r.provider}</p>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 font-display text-lg leading-snug font-bold hover:text-primary">
                      {title(r)}<Icon name="external" className="size-4" /><span className="sr-only">{t('learning.newTab')}</span>
                    </a>
                    <p className="mt-1 text-sm text-muted">{td('resourceReason', { skill: skill.name_ar })}</p>
                    <p className="mt-1 text-xs text-muted">{td('verifiedOn', { date: formatDate(locale, r.verified_on, 'UTC') })}</p>
                  </div>
                  <SavePlanButton skillId={skill.id} kind={r.kind} resourceId={r.id} saved={inPlan(skill.id, r.kind, r.id)} label={t('learning.addToPlan')} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <p className="text-xs text-muted">{t('learning.missing')}</p>
    </div>
  );
}
