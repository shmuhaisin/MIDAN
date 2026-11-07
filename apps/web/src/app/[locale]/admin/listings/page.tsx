import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingActions, ListingUpload } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatWhen } from '@/lib/format';

type Listing = {
  id: string; job_id: string | null; title_original: string | null; title_ar: string | null; title_en: string | null; employer_name_raw: string | null; source_type: string; source_name: string; source_url: string;
  collected_at: string | null; match_status: string; match_confidence: string | null; match_evidence: { rule?: string; candidates?: { id: string; name_ar: string; name_en: string }[] } | null;
  sector_code: string | null; job_family_ar: string | null; classification_confidence: number | null; mentions: number | null; review_status: string; published: boolean; duplicate_of: string | null;
  registry_id: string | null; registry_name_ar: string | null; registry_name_en: string | null; skills: { name_ar: string; evidence: string }[]; location: string | null;
};

const FILTERS = ['', 'pending', 'approved', 'rejected'];

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ review?: string }> }) {
  const { locale } = await params;
  const { review = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.listings' });
  const listings = await api<Listing[]>(`/admin/listings${review ? `?review=${review}` : ''}`);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <ListingUpload />
      <nav aria-label={t('filter')} className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f || 'all'} href={`/admin/listings${f ? `?review=${f}` : ''}`} aria-current={review === f ? 'page' : undefined}
            className={review === f ? 'rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground' : 'rounded-full border border-border px-3 py-1'}>
            {t(`filters.${f || 'all'}`)}
          </Link>
        ))}
      </nav>
      {listings.length === 0 ? <EmptyState title={t('empty')} body={t('emptyBody')} /> : (
        <ul className="space-y-3">
          {listings.map((l) => (
            <li key={l.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="subsection-title">{l.title_original ?? l.title_ar ?? l.title_en}</h2>
                <span className="flex flex-wrap gap-2">
                  <Badge tone={['matched', 'confirmed'].includes(l.match_status) ? 'active' : l.match_status === 'rejected' ? 'danger' : 'warning'}>
                    {t(`match.${l.match_status}`)}{l.match_confidence != null && ` · ${Number(l.match_confidence).toFixed(2)}`}
                  </Badge>
                  <Badge tone={l.review_status === 'approved' ? 'active' : l.review_status === 'rejected' ? 'danger' : 'neutral'}>{t(`review.${l.review_status}`)}</Badge>
                  {l.published && <Badge tone="active">{t('published')}</Badge>}
                  {l.duplicate_of && <Badge tone="warning">{t('duplicate')}</Badge>}
                </span>
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-muted">{t('collectedName')}: </dt><dd className="inline">{l.employer_name_raw ?? '—'}</dd></div>
                <div><dt className="inline text-muted">{t('registry')}: </dt><dd className="inline">{l.registry_name_ar ? `${l.registry_name_ar} · ${l.registry_name_en}` : '—'}</dd></div>
                <div><dt className="inline text-muted">{t('rule')}: </dt><dd className="inline">{l.match_evidence?.rule ? (t.has(`rules.${l.match_evidence.rule}`) ? t(`rules.${l.match_evidence.rule}`) : l.match_evidence.rule) : '—'}</dd></div>
                <div><dt className="inline text-muted">{t('source')}: </dt><dd className="inline"><a href={l.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t(`sourceTypes.${l.source_type}`)}</a>{l.collected_at && ` · ${formatWhen(locale, l.collected_at, 'Asia/Riyadh')}`}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-muted">{t('classification')}: </dt><dd className="inline">
                  {l.sector_code ? `${t(`sectors.${l.sector_code}`)}${l.job_family_ar ? ` · ${l.job_family_ar}` : ''} · ${t('confidence', { value: Number(l.classification_confidence ?? 0).toFixed(2), mentions: l.mentions ?? 0 })}` : t('unclassified')}
                </dd></div>
              </dl>
              {l.skills.length > 0 && (
                <p className="text-sm"><span className="text-muted">{t('skills')}: </span>{l.skills.map((s) => s.name_ar).join('، ')}</p>
              )}
              <ListingActions id={l.id} matchStatus={l.match_status} reviewStatus={l.review_status} published={l.published} duplicate={Boolean(l.duplicate_of)}
                candidates={l.match_evidence?.candidates ?? []} registryId={l.registry_id} jobId={l.job_id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
