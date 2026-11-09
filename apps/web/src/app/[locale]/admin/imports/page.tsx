import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatWhen, number } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';

type Run = { id: string; kind: string; status: string; sources: { file: string }[]; stats: { by_status?: Record<string, number> }; started_by: string; started_at: string; failure: string | null };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.imports' });
  const runs = await api<Run[]>('/admin/imports');
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      {runs.length === 0 ? <p className="card">{t('empty')}</p> : (
        <DataTable caption={t('title')} head={[t('kind'), t('status'), t('sources'), t('counts'), t('startedBy'), t('when')]}>
          {runs.map((r) => (
            <tr key={r.id}>
              <Cell><Link href={`/admin/imports/${r.id}`} className="link">{t(`kinds.${r.kind}`)}</Link></Cell>
              <Cell><Badge tone={r.status === 'completed' ? 'active' : r.status === 'failed' ? 'danger' : 'neutral'}>{t(`statuses.${r.status}`)}</Badge>{r.failure && <p className="mt-1 text-xs text-error">{r.failure}</p>}</Cell>
              <Cell>{r.sources.length ? number(locale, r.sources.length) : '—'}</Cell>
              <Cell>
                <ul className="space-y-0.5">
                  {Object.entries(r.stats.by_status ?? {}).map(([k, v]) => <li key={k}>{t(`recordStatus.${k}`)}: <span className="tabular-nums">{number(locale, v)}</span></li>)}
                  {!Object.keys(r.stats.by_status ?? {}).length && <li className="text-muted">{t('noRows')}</li>}
                </ul>
              </Cell>
              <Cell ltr>{r.started_by}</Cell>
              <Cell>{formatWhen(locale, r.started_at, 'Asia/Riyadh')}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
