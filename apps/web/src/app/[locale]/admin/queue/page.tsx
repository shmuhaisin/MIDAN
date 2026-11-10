import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RetryJobButton } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatWhen, number } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';
import { requirePlatformAdmin } from '@/lib/platform-admin';

type Job = { id: string; kind: string; status: string; attempts: number; max_attempts: number; last_error: string | null; run_after: string; created_at: string; finished_at: string | null };
const FILTERS = ['', 'failed', 'queued', 'running', 'succeeded'];

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;
  const { status = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.queue' });
  const jobs = await api<Job[]>(`/admin/background-jobs${status ? `?status=${status}` : ''}`);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <nav aria-label={t('filter')} className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f || 'all'} href={`/admin/queue${f ? `?status=${f}` : ''}`} aria-current={status === f ? 'page' : undefined}
            className={status === f ? 'btn btn-primary' : 'rounded-full border border-border px-3 py-1'}>
            {t(`statuses.${f || 'all'}`)}
          </Link>
        ))}
      </nav>
      {jobs.length === 0 ? <EmptyState title={t('empty')} /> : (
        <DataTable caption={t('title')} head={[t('kind'), t('status'), t('attempts'), t('error'), t('created'), '']}>
          {jobs.map((j) => (
            <tr key={j.id}>
              <Cell>{t(`kinds.${j.kind}`)}</Cell>
              <Cell><Badge tone={j.status === 'failed' ? 'danger' : j.status === 'succeeded' ? 'active' : 'neutral'}>{t(`statuses.${j.status}`)}</Badge></Cell>
              <Cell className="tabular-nums">{number(locale, j.attempts)} / {number(locale, j.max_attempts)}</Cell>
              <Cell ltr className="text-xs">{j.last_error}</Cell>
              <Cell>{formatWhen(locale, j.created_at, 'Asia/Riyadh')}</Cell>
              <Cell>{j.status === 'failed' && j.kind !== 'cv_analysis' && <RetryJobButton id={j.id} />}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
