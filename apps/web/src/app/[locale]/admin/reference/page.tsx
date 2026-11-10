import { getTranslations, setRequestLocale } from 'next-intl/server';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';
import { requirePlatformAdmin } from '@/lib/platform-admin';

type Row = { sector_code: string; technical: number; general: number; priority_flagged: number; priority_listed: number; without_description: number; contexts: number; subsectors: number; job_families: number; source_file: string };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.reference' });
  const ts = await getTranslations({ locale, namespace: 'admin.listings.sectors' });
  const rows = await api<Row[]>('/admin/reference');
  const n = (v: number) => number(locale, v);
  const sum = (k: keyof Row) => rows.reduce((a, r) => a + Number(r[k]), 0);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <DataTable caption={t('title')} head={[t('sector'), t('technical'), t('general'), t('priorityFlagged'), t('priorityListed'), t('noDescription'), t('contexts'), t('subsectors'), t('families'), t('file')]}>
        {rows.map((r) => (
          <tr key={r.sector_code}>
            <Cell className="font-semibold">{ts(r.sector_code)}</Cell>
            <Cell className="tabular-nums">{n(r.technical)}</Cell><Cell className="tabular-nums">{n(r.general)}</Cell>
            <Cell className="tabular-nums">{n(r.priority_flagged)}</Cell><Cell className="tabular-nums">{n(r.priority_listed)}</Cell>
            <Cell className="tabular-nums">{n(r.without_description)}</Cell><Cell className="tabular-nums">{n(r.contexts)}</Cell>
            <Cell className="tabular-nums">{n(r.subsectors)}</Cell><Cell className="tabular-nums">{n(r.job_families)}</Cell>
            <Cell className="text-xs">{r.source_file}</Cell>
          </tr>
        ))}
        <tr className="font-semibold">
          <Cell>{t('total')}</Cell><Cell className="tabular-nums">{n(sum('technical'))}</Cell><Cell className="tabular-nums">{n(sum('general'))}</Cell>
          <Cell className="tabular-nums">{n(sum('priority_flagged'))}</Cell><Cell className="tabular-nums">{n(sum('priority_listed'))}</Cell>
          <Cell className="tabular-nums">{n(sum('without_description'))}</Cell><Cell className="tabular-nums">{n(sum('contexts'))}</Cell><Cell /><Cell /><Cell />
        </tr>
      </DataTable>
      <p className="max-w-3xl text-sm text-muted">{t('note')}</p>
    </div>
  );
}
