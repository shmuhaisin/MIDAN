import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RecordActions } from '@/components/admin';
import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';

type Item = { id: number; run_id: string; kind: string; entity: string; source_file: string | null; source_sheet: string | null; source_row: number | null; original_value: unknown; status: string; issue_kind: string | null; detail: string | null };
type Listing = { id: string; title_original: string; match_status: string };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.review' });
  const ti = await getTranslations({ locale, namespace: 'admin.imports' });
  const { records, listings } = await api<{ records: Item[]; listings: Listing[] }>('/admin/review');
  const groups = Object.entries(records.reduce<Record<string, Item[]>>((acc, r) => ({ ...acc, [r.issue_kind ?? r.status]: [...(acc[r.issue_kind ?? r.status] ?? []), r] }), {}));
  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <section className="space-y-2">
        <h2 className="section-title">{t('listings', { count: listings.length })}</h2>
        {listings.length ? (
          <p className="text-sm"><Link href="/admin/listings?review=pending" className="link">{t('openListings')}</Link></p>
        ) : <p className="text-sm text-muted">{t('noListings')}</p>}
      </section>
      {groups.length === 0 ? <EmptyState title={t('empty')} /> : groups.map(([kind, items]) => (
        <details key={kind} className="space-y-2" open={items.length <= 30}>
          <summary className="cursor-pointer section-title">{ti.has(`issues.${kind}`) ? ti(`issues.${kind}`) : kind} · {number(locale, items.length)}</summary>
          {ti.has(`issueHelp.${kind}`) && <p className="max-w-3xl text-sm text-muted">{ti(`issueHelp.${kind}`)}</p>}
          <DataTable caption={kind} head={[ti('where'), ti('original'), ti('issue'), '']}>
            {items.map((r) => (
              <tr key={r.id}>
                <Cell><span className="block">{r.source_file}</span><span className="text-muted">{r.source_sheet}{r.source_row != null && ` · ${ti('row', { row: r.source_row })}`}</span></Cell>
                <Cell className="max-w-xs break-words">{typeof r.original_value === 'string' ? r.original_value : JSON.stringify(r.original_value)?.slice(0, 160)}</Cell>
                <Cell className="text-muted">{r.detail}</Cell>
                <Cell><RecordActions id={r.id} /></Cell>
              </tr>
            ))}
          </DataTable>
        </details>
      ))}
    </div>
  );
}
