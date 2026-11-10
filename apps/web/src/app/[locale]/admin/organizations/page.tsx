import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReviewStatusBadge } from '@/components/verification';
import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatDate, number } from '@/lib/format';
import { REVIEW_STATUSES, type ReviewStatus } from '@/lib/verification';
import { Cell, DataTable } from '../admin-kit';
import { requirePlatformAdmin } from '@/lib/platform-admin';

type Row = {
  id: string; slug: string; name_ar: string; name_en: string; is_demo: boolean; is_test: boolean; created_at: string;
  verification_status: ReviewStatus; verification_updated_at: string | null; commercial_registration: string | null; city: string | null;
  last_submitted_at: string | null; submissions: number; members: number; jobs: number; published_jobs: number;
};

/** Organization applications and accounts. Waiting reviews come first; every count is from the database. */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; q?: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;
  const { status, q = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.organizations' });
  const ts = await getTranslations({ locale, namespace: 'verification.status' });
  const wanted = REVIEW_STATUSES.includes(status as ReviewStatus) ? (status as ReviewStatus) : undefined;
  const query = new URLSearchParams({ ...(wanted && { status: wanted }), ...(q.trim() && { q: q.trim() }) }).toString();
  const [rows, all] = await Promise.all([
    api<Row[]>(`/admin/organizations${query ? `?${query}` : ''}`),
    api<{ counts: Record<string, number> }>('/admin/overview'),
  ]);
  const counts: Record<string, number> = {
    pending_review: all.counts.organizations_pending_review, changes_requested: all.counts.organizations_changes_requested,
    approved: all.counts.organizations_approved, rejected: all.counts.organizations_rejected, suspended: all.counts.organizations_suspended,
    draft: all.counts.organizations_draft,
  };
  const href = (s?: string) => `/admin/organizations${s || q ? `?${new URLSearchParams({ ...(s && { status: s }), ...(q && { q }) })}` : ''}`;
  const order: ReviewStatus[] = ['pending_review', 'changes_requested', 'approved', 'suspended', 'rejected', 'draft'];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">{t('title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t('lead')}</p>
      </div>
      <nav aria-label={t('filters')} className="flex flex-wrap gap-2">
        <Link href={href()} aria-current={!wanted ? 'page' : undefined} className="chip">{t('all')}</Link>
        {order.map((s) => (
          <Link key={s} href={href(s)} aria-current={wanted === s ? 'page' : undefined} className="chip">
            {ts(s)} <span className="tabular-nums text-muted">{number(locale, counts[s] ?? 0)}</span>
          </Link>
        ))}
      </nav>
      <form role="search" className="flex gap-2">
        {wanted && <input type="hidden" name="status" value={wanted} />}
        <label htmlFor="org-q" className="sr-only">{t('search')}</label>
        <input id="org-q" name="q" defaultValue={q} placeholder={t('search')} className="input max-w-sm" />
        <button type="submit" className="btn btn-secondary btn-sm">{t('searchButton')}</button>
      </form>
      {rows.length === 0 ? <EmptyState title={t('empty')} body={t('emptyBody')} /> : (
        <DataTable caption={t('title')} head={[t('organization'), t('status'), t('cr'), t('submitted'), t('activity')]}>
          {rows.map((o) => (
            <tr key={o.id}>
              <Cell>
                <Link href={`/admin/organizations/${o.id}`} className="link font-medium">{locale === 'ar' ? o.name_ar : o.name_en}</Link>
                <span className="block text-xs text-muted" dir="ltr">{o.slug}{o.is_test ? ` · ${t('test')}` : ''}{o.is_demo ? ` · ${t('demo')}` : ''}</span>
              </Cell>
              <Cell><ReviewStatusBadge status={o.verification_status} /></Cell>
              <Cell ltr>{o.commercial_registration ?? '—'}</Cell>
              <Cell>{o.last_submitted_at ? formatDate(locale, o.last_submitted_at, 'Asia/Riyadh') : '—'}{o.submissions > 1 && <span className="block text-xs text-muted">{t('submissions', { count: o.submissions })}</span>}</Cell>
              <Cell>{t('activityLine', { members: o.members, jobs: o.jobs, published: o.published_jobs })}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
