import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui';
import { RecordActions } from '@/components/admin';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatWhen, number } from '@/lib/format';
import { notFound } from 'next/navigation';
import { Cell, DataTable } from '../../admin-kit';
import { requirePlatformAdmin } from '@/lib/platform-admin';

type Sheet = { sheet: string; handling?: string; rows?: number; state?: string };
type Run = {
  id: string; kind: string; status: string; started_at: string; finished_at: string | null; started_by: string;
  sources: { file?: string; sha256?: string; sheets?: Sheet[]; sheet?: string; rows?: number }[];
  stats: { by_status?: Record<string, number>; by_entity?: Record<string, number>; issues?: Record<string, number> };
  report: { readme?: string[][]; note?: string; workbooks?: { file: string; priority?: { stated_total: number | null; listed: number; flagged_in_skill_list: number } }[] };
};
type Record_ = { id: number; entity: string; source_file: string | null; source_sheet: string | null; source_row: number | null; original_value: unknown; status: string; issue_kind: string | null; detail: string | null; review_status: string | null };

const FILTERS = ['', 'ambiguous', 'rejected', 'duplicate', 'warning', 'imported', 'updated', 'unchanged'];

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ status?: string }> }) {
  await requirePlatformAdmin();
  const { locale, id } = await params;
  const { status = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.imports' });
  const data = await apiForPage<{ run: Run; records: Record_[] }>(`/admin/imports/${id}${status ? `?status=${status}` : ''}`);
  if (!data) notFound();
  const { run, records } = data;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/imports" className="text-sm underline underline-offset-4">{t('back')}</Link>
        <h2 className="mt-2 section-title">{t(`kinds.${run.kind}`)} · {formatWhen(locale, run.started_at, 'Asia/Riyadh')}</h2>
        <p className="text-sm text-muted" dir="ltr">{run.id} · {run.started_by}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {(['by_status', 'by_entity', 'issues'] as const).map((group) => (
          <div key={group} className="card">
            <h3 className="subsection-title">{t(`groups.${group}`)}</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(run.stats[group] ?? {}).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3"><span>{group === 'by_status' ? t(`recordStatus.${k}`) : group === 'issues' ? t.has(`issues.${k}`) ? t(`issues.${k}`) : k : k}</span><span className="tabular-nums">{number(locale, v)}</span></li>
              ))}
              {!Object.keys(run.stats[group] ?? {}).length && <li className="text-muted">—</li>}
            </ul>
          </div>
        ))}
      </div>

      {run.report.note && <p className="card border-s-2 border-gold">{t('emptySourceNote')}</p>}

      <div className="space-y-3">
        <h3 className="subsection-title">{t('sourcesTitle')}</h3>
        {run.sources.map((s, i) => (
          <details key={i} className="card">
            <summary className="cursor-pointer font-semibold">{s.file ?? '—'} {s.sheet && <span className="text-muted">· {s.sheet} ({number(locale, s.rows ?? 0)})</span>}</summary>
            {s.sha256 && <p className="mt-2 break-all text-xs text-muted" dir="ltr">sha256 {s.sha256}</p>}
            {s.sheets && (
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {s.sheets.map((sh) => (
                  <li key={sh.sheet} className="flex justify-between gap-2 border-b border-border py-1">
                    <span>{sh.sheet}</span>
                    <span className="text-muted">{sh.handling ? (t.has(`handling.${sh.handling}`) ? t(`handling.${sh.handling}`) : sh.handling) : t('handling.read')}{sh.rows != null && ` · ${number(locale, sh.rows)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
        {run.report.readme && (
          <details className="card"><summary className="cursor-pointer font-semibold">README</summary>
            <ul className="mt-2 space-y-1 text-sm" dir="ltr">{run.report.readme.map((r, i) => <li key={i}><strong>{r[0]}</strong> {r.slice(1).join(' · ')}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="subsection-title">{t('recordsTitle')}</h3>
        <nav aria-label={t('filter')} className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map((f) => (
            <Link key={f || 'all'} href={`/admin/imports/${id}${f ? `?status=${f}` : ''}`} aria-current={status === f ? 'page' : undefined}
              className={status === f ? 'btn btn-primary' : 'rounded-full border border-border px-3 py-1'}>
              {f ? t(`recordStatus.${f}`) : t('needsAttention')}
            </Link>
          ))}
        </nav>
        {records.length === 0 ? <p className="card">{t('noRecords')}</p> : (
          <DataTable caption={t('recordsTitle')} head={[t('status'), t('entity'), t('where'), t('original'), t('issue'), '']}>
            {records.map((r) => (
              <tr key={r.id}>
                <Cell><Badge tone={['rejected'].includes(r.status) ? 'danger' : ['ambiguous', 'duplicate', 'warning'].includes(r.status) ? 'warning' : 'neutral'}>{t(`recordStatus.${r.status}`)}</Badge></Cell>
                <Cell>{r.entity}</Cell>
                <Cell><span className="block">{r.source_file}</span><span className="text-muted">{r.source_sheet}{r.source_row != null && ` · ${t('row', { row: r.source_row })}`}</span></Cell>
                <Cell className="max-w-xs break-words">{typeof r.original_value === 'string' ? r.original_value : r.original_value ? <code className="text-xs" dir="ltr">{JSON.stringify(r.original_value).slice(0, 200)}</code> : null}</Cell>
                <Cell>{r.issue_kind && <span className="block font-medium">{t.has(`issues.${r.issue_kind}`) ? t(`issues.${r.issue_kind}`) : r.issue_kind}</span>}{r.detail && <span className="text-muted">{r.detail}</span>}</Cell>
                <Cell>{r.review_status === 'open' ? <RecordActions id={r.id} /> : r.review_status ? t(`resolution.${r.review_status}`) : null}</Cell>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  );
}
