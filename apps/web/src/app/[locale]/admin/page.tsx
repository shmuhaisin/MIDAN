import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Icon, type IconName } from '@/components/icons';
import { Badge } from '@/components/ui';
import { Masthead } from '@/components/workspace-kit';
import { api } from '@/lib/api';
import { number } from '@/lib/format';

type Overview = {
  counts: Record<string, number>;
  integrations: { ai_service: { reachable: boolean; mode?: string }; daily: { configured: boolean }; google_calendar: { configured: boolean }; email: { configured: boolean }; background_worker: { enabled: boolean } };
};

/** Queues that wait for a person, in the order they're dealt with. Each count comes from `GET /admin/overview`. */
const QUEUES: [key: string, count: string, path: string][] = [
  ['openReview', 'open_review_items', '/review'],
  ['listingsPending', 'listings_pending_review', '/listings'],
  ['uncertainMatches', 'uncertain_matches', '/listings'],
  ['failedJobs', 'failed_jobs', '/queue'],
  ['failedImports', 'failed_imports', '/imports'],
];

/** What the platform holds, in three groups, each led by its most telling figure. */
const GROUPS: { key: string; icon: IconName; lead: [string, string, string?]; rest: [string, string, string?][] }[] = [
  { key: 'people', icon: 'users', lead: ['users', 'users', '/accounts'], rest: [['organizations', 'organizations', '/accounts'], ['testOrganizations', 'test_organizations', '/accounts']] },
  { key: 'market', icon: 'briefcase', lead: ['publishedJobs', 'published_jobs'], rest: [['externalListings', 'external_listings', '/listings'], ['employers', 'employers', '/employers']] },
  { key: 'knowledge', icon: 'layers', lead: ['referenceSkills', 'reference_skills', '/reference'], rest: [['learningResources', 'learning_resources', '/learning'], ['importRuns', 'import_runs', '/imports']] },
];

/**
 * The platform console's first page: what needs a person now, what the platform holds, and whether its services are
 * set up. Separate from any organization's settings, and shown only to platform administrators (see the layout).
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.overview' });
  const { counts, integrations } = await api<Overview>('/admin/overview');
  const n = (v: number | undefined) => number(locale, v ?? 0);
  const href = (path: string) => `/${locale}/admin${path}`;
  const queues = QUEUES.map(([key, count, path]) => ({ key, value: counts[count] ?? 0, path }));
  const waiting = queues.filter((q) => q.value > 0).sort((a, b) => b.value - a.value);
  const clear = queues.filter((q) => q.value === 0);
  const total = waiting.reduce((sum, q) => sum + q.value, 0);
  const state = (ok: boolean) => <Badge tone={ok ? 'active' : 'warning'}>{ok ? t('configured') : t('notConfigured')}</Badge>;
  const services: { key: string; badge: React.ReactNode; note: string }[] = [
    {
      key: 'ai',
      badge: integrations.ai_service.reachable
        ? <Badge tone={integrations.ai_service.mode === 'live' ? 'active' : 'warning'}>{t(`aiMode.${integrations.ai_service.mode === 'live' ? 'live' : 'demo'}`)}</Badge>
        : <Badge tone="danger">{t('unreachable')}</Badge>,
      note: t('serviceNote.ai'),
    },
    { key: 'daily', badge: state(integrations.daily.configured), note: t('serviceNote.daily') },
    { key: 'calendar', badge: state(integrations.google_calendar.configured), note: t('serviceNote.calendar') },
    { key: 'email', badge: <Badge tone="warning">{t('emailState')}</Badge>, note: t('serviceNote.email') },
    { key: 'worker', badge: state(integrations.background_worker.enabled), note: t('serviceNote.worker') },
  ];

  return (
    <div className="space-y-10">
      <Masthead eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />

      <section aria-labelledby="attention" className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
        <div className="grid gap-6 border-b border-border p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h2 id="attention" className="font-display text-2xl font-bold">{t('attentionTitle')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t('attentionLead')}</p>
          </div>
          <p className={clsx('num font-display text-5xl font-bold leading-none', total > 0 ? 'text-gold-text' : 'text-primary')} aria-label={t('attentionTotal', { count: total })}>
            {n(total)}
          </p>
        </div>
        {waiting.length === 0 ? (
          <p className="flex items-center gap-3 px-6 py-6 sm:px-8"><Icon name="check" className="size-5 text-primary" />{t('allClear')}</p>
        ) : (
          <ol className="divide-y divide-border">
            {waiting.map((q) => (
              <li key={q.key}>
                <a href={href(q.path)} className="group grid gap-x-6 gap-y-1 px-6 py-5 transition-colors hover:bg-surface-2/50 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center sm:px-8">
                  <span className="num font-display text-3xl font-bold text-gold-text">{n(q.value)}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{t(`counts.${q.key}`)}</span>
                    <span className="mt-0.5 block text-sm text-muted">{t(`queueNote.${q.key}`)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">{t('open')}<Arrow className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" /></span>
                </a>
              </li>
            ))}
          </ol>
        )}
        {waiting.length > 0 && clear.length > 0 && (
          <p className="border-t border-border bg-surface-2/40 px-6 py-3 text-sm text-muted sm:px-8">
            <Icon name="check" className="me-1.5 inline size-4 text-primary" />{t('alsoClear', { list: clear.map((q) => t(`counts.${q.key}`)).join(locale === 'ar' ? '، ' : ', ') })}
          </p>
        )}
      </section>

      <section aria-labelledby="glance">
        <h2 id="glance" className="section-title">{t('glanceTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('glanceLead')}</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {GROUPS.map((g, i) => {
            const [leadKey, leadCount, leadPath] = g.lead;
            return (
              <article key={g.key} className={clsx('flex flex-col rounded-[var(--radius-panel)] border p-6', i === 0 ? 'on-deep deep-grain border-deep bg-deep text-deep-foreground' : 'border-border bg-surface')}>
                <p className={clsx('flex items-center gap-2 text-sm font-semibold', i === 0 ? 'text-brand-gold' : 'text-gold-text')}><Icon name={g.icon} className="size-4" />{t(`groups.${g.key}`)}</p>
                <p className="num mt-5 font-display text-5xl font-bold leading-none">{n(counts[leadCount])}</p>
                <p className={clsx('mt-2 text-sm', i === 0 ? 'text-deep-muted' : 'text-muted')}>
                  {leadPath ? <a href={href(leadPath)} className="underline-offset-4 hover:underline">{t(`counts.${leadKey}`)}</a> : t(`counts.${leadKey}`)}
                </p>
                <dl className={clsx('mt-6 space-y-2 border-t pt-4 text-sm', i === 0 ? 'border-mint/15' : 'border-border')}>
                  {g.rest.map(([key, count, path]) => (
                    <div key={key} className="flex items-baseline justify-between gap-3">
                      <dt>{path ? <a href={href(path)} className="underline-offset-4 hover:underline">{t(`counts.${key}`)}</a> : t(`counts.${key}`)}</dt>
                      <dd className="num font-semibold">{n(counts[count])}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="services">
        <h2 id="services" className="section-title">{t('integrations')}</h2>
        <p className="mt-1 text-sm text-muted">{t('integrationsLead')}</p>
        <ul className="mt-4 grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
          {services.map((s) => (
            <li key={s.key} className="flex flex-col gap-3 bg-surface p-5">
              <span className="font-semibold">{t(s.key)}</span>
              <span>{s.badge}</span>
              <span className="text-xs leading-relaxed text-muted">{s.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
