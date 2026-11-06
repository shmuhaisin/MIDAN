import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { Stat } from './admin-kit';

type Overview = {
  counts: Record<string, number>;
  integrations: { ai_service: { reachable: boolean; mode?: string }; daily: { configured: boolean }; google_calendar: { configured: boolean }; email: { configured: boolean }; background_worker: { enabled: boolean } };
};

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.overview' });
  const { counts, integrations } = await api<Overview>('/admin/overview');
  const href = (path: string) => `/${locale}/admin${path}`;
  const stats: [string, number, string?][] = [
    ['openReview', counts.open_review_items, '/review'], ['listingsPending', counts.listings_pending_review, '/listings'],
    ['uncertainMatches', counts.uncertain_matches, '/listings'], ['failedJobs', counts.failed_jobs, '/queue'], ['failedImports', counts.failed_imports, '/imports'],
    ['employers', counts.employers, '/employers'], ['referenceSkills', counts.reference_skills, '/reference'], ['externalListings', counts.external_listings, '/listings'],
    ['learningResources', counts.learning_resources, '/learning'], ['users', counts.users, '/accounts'], ['organizations', counts.organizations, '/accounts'],
    ['publishedJobs', counts.published_jobs], ['importRuns', counts.import_runs, '/imports'], ['testOrganizations', counts.test_organizations, '/accounts'],
  ];
  const state = (ok: boolean) => <Badge tone={ok ? 'active' : 'warning'}>{ok ? t('configured') : t('notConfigured')}</Badge>;
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([key, value, path]) => <Stat key={key} label={t(`counts.${key}`)} value={number(locale, value)} href={path ? href(path) : undefined} />)}
      </div>
      <div>
        <h2 className="section-title">{t('integrations')}</h2>
        <p className="mt-1 text-sm text-muted">{t('integrationsLead')}</p>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span>{t('ai')}</span>
            {integrations.ai_service.reachable
              ? <Badge tone={integrations.ai_service.mode === 'live' ? 'active' : 'warning'}>{t(`aiMode.${integrations.ai_service.mode === 'live' ? 'live' : 'demo'}`)}</Badge>
              : <Badge tone="danger">{t('unreachable')}</Badge>}
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>{t('daily')}</span>{state(integrations.daily.configured)}</li>
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>{t('calendar')}</span>{state(integrations.google_calendar.configured)}</li>
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>{t('email')}</span><Badge tone="warning">{t('emailState')}</Badge></li>
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>{t('worker')}</span>{state(integrations.background_worker.enabled)}</li>
        </ul>
      </div>
    </div>
  );
}
