import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';

type Entry = { id: number; actor_email: string | null; action: string; entity: string; entity_id: string | null; details: Record<string, unknown>; created_at: string };

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ entity?: string; before?: string }> }) {
  const { locale } = await params;
  const { entity = '', before = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.audit' });
  const query = new URLSearchParams({ ...(entity && { entity }), ...(before && { before }) }).toString();
  const entries = await api<Entry[]>(`/admin/audit${query ? `?${query}` : ''}`);
  const last = entries.at(-1);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <form className="flex gap-2" role="search">
        <label className="sr-only" htmlFor="entity">{t('entity')}</label>
        <input id="entity" name="entity" defaultValue={entity} dir="ltr" placeholder={t('entityPlaceholder')} className="h-10 w-full max-w-sm rounded-lg border border-border bg-surface px-3" />
        <button type="submit" className="rounded-full border border-border px-4 text-sm font-semibold">{t('filter')}</button>
      </form>
      {entries.length === 0 ? <EmptyState title={t('empty')} /> : (
        <DataTable caption={t('title')} head={[t('when'), t('actor'), t('action'), t('entity'), t('details')]}>
          {entries.map((e) => (
            <tr key={e.id}>
              <Cell>{formatWhen(locale, e.created_at, 'Asia/Riyadh')}</Cell>
              <Cell ltr>{e.actor_email ?? t('system')}</Cell>
              <Cell ltr>{e.action}</Cell>
              <Cell ltr>{e.entity}<span className="block text-xs text-muted">{e.entity_id}</span></Cell>
              <Cell ltr className="text-xs">{Object.keys(e.details ?? {}).length ? JSON.stringify(e.details) : ''}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
      {entries.length === 200 && last && (
        <Link href={`/admin/audit?${new URLSearchParams({ ...(entity && { entity }), before: String(last.id) })}`} className="text-sm font-semibold underline underline-offset-4">{t('older')}</Link>
      )}
    </div>
  );
}
