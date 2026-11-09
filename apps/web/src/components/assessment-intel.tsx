'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { runQualityCheck, setCompanyType } from '@/lib/actions';
import { formatWhen, number, pick } from '@/lib/format';
import { ErrorText, INPUT, PRIMARY, useAction } from './forms';

export const COMPANY_TYPES = ['private_company', 'startup', 'sme', 'large_enterprise', 'government_entity', 'semi_government', 'nonprofit', 'multinational'] as const;

/** The organization's type. Generation receives it with the job's sector and level; the organization's name is never sent. */
export function CompanyTypeForm({ orgId, value, canEdit }: { orgId: string; value: string | null; canEdit: boolean }) {
  const t = useTranslations('assessmentIntel');
  const [type, setType] = useState(value ?? '');
  const { pending, error, fire } = useAction(() => setCompanyType(orgId, type));
  return (
    <section aria-labelledby="company-type" className="mt-10">
      <h2 id="company-type" className="section-title">{t('companyTypeTitle')}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">{t('companyTypeNote')}</p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); fire(); }}>
        <label className="block min-w-64">
          <span className="field-label">{t('companyType')}</span>
          <select value={type} disabled={!canEdit} onChange={(e) => setType(e.target.value)} className={INPUT}>
            <option value="">{t('notSet')}</option>
            {COMPANY_TYPES.map((k) => <option key={k} value={k}>{t(`companyTypes.${k}`)}</option>)}
          </select>
        </label>
        {canEdit && <button type="submit" disabled={pending || !type} aria-busy={pending} className={PRIMARY}>{t('save')}</button>}
      </form>
      <ErrorText code={error} />
    </section>
  );
}

type Finding = { code: string; severity: 'error' | 'warning'; message: string; where?: string };
export type QualityReport = null | {
  verdict: 'ready' | 'needs_revision' | 'blocked'; overall_score: number; standardized: boolean; created_at: string; current: boolean;
  report: { dimensions?: Record<string, { score: number; missing?: string[] }>; errors?: Finding[]; warnings?: Finding[]; required_revisions?: string[] };
};

/**
 * MIDAN's quality report on a draft, against the MIDAN Assessment Standard. Staff only. A generated version can't be
 * approved without a ready report on its current content; the database refuses it otherwise.
 */
export function QualityPanel({ orgId, versionId, quality, canCheck, gated }: { orgId: string; versionId: string; quality: QualityReport; canCheck: boolean; gated: boolean }) {
  const t = useTranslations('assessmentIntel');
  const locale = useLocale();
  const { pending, error, fire } = useAction(() => runQualityCheck(orgId, versionId));
  const report = quality?.report;
  return (
    <section aria-labelledby={`quality-${versionId}`} className="rounded-lg bg-surface p-4">
      <h3 id={`quality-${versionId}`} className="subsection-title">{t('qualityTitle')}</h3>
      <p className="mt-1 text-sm text-muted">{t(gated ? 'qualityGated' : 'qualityNotGated')}</p>
      {!quality ? <p className="mt-3 text-sm">{t('qualityNone')}</p> : (
        <div className="mt-3 space-y-3 text-sm">
          <p>
            <span className="font-semibold">{t(`verdict.${quality.verdict}`)}</span> · {t('qualityScore', { score: number(locale, quality.overall_score) })}
            {' · '}{formatWhen(locale, quality.created_at, 'Asia/Riyadh')}
            {!quality.current && <span className="ms-2 font-semibold text-error">{t('qualityStale')}</span>}
          </p>
          {!quality.standardized && <p className="text-muted">{t('notStandardized')}</p>}
          {(report?.errors ?? []).length > 0 && (
            <div role="alert" className="border-s-2 border-error ps-3">
              <p className="font-semibold">{t('qualityErrors')}</p>
              <ul className="mt-1 list-disc space-y-1 ps-4">{report!.errors!.map((f, i) => <li key={i}><bdi dir="ltr">{f.message}</bdi></li>)}</ul>
            </div>
          )}
          {(report?.required_revisions ?? []).length > 0 && (
            <div>
              <p className="font-semibold">{t('qualityRevisions')}</p>
              <ul className="mt-1 list-disc space-y-1 ps-4">{report!.required_revisions!.map((r, i) => <li key={i}><bdi dir="ltr">{r}</bdi></li>)}</ul>
            </div>
          )}
          {(report?.warnings ?? []).length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">{t('qualityWarnings', { count: report!.warnings!.length })}</summary>
              <ul className="mt-1 list-disc space-y-1 ps-4">{report!.warnings!.map((f, i) => <li key={i}><bdi dir="ltr">{f.message}</bdi></li>)}</ul>
            </details>
          )}
          {report?.dimensions && (
            <details>
              <summary className="cursor-pointer font-semibold">{t('qualityDimensions')}</summary>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {Object.entries(report.dimensions).map(([name, d]) => <li key={name} className="tabular-nums"><bdi dir="ltr">{name.replaceAll('_', ' ')}</bdi>: {number(locale, d.score)}</li>)}
              </ul>
            </details>
          )}
          <p className="text-xs text-muted">{t('qualityEnglish')}</p>
        </div>
      )}
      {canCheck && <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className="btn btn-secondary btn-sm mt-3">{t('runCheck')}</button>}
      <ErrorText code={error} />
    </section>
  );
}

function Value({ value }: { value: unknown }) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) {
    return <ul className="list-disc space-y-1 ps-5">{value.map((v, i) => <li key={i}><Value value={v} /></li>)}</ul>;
  }
  if (typeof value === 'object') {
    return (
      <dl className="space-y-1">
        {Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => (
          <div key={k}><dt className="text-xs font-semibold text-muted"><bdi dir="ltr">{k.replaceAll('_', ' ')}</bdi></dt><dd><Value value={v} /></dd></div>
        ))}
      </dl>
    );
  }
  return <bdi className="whitespace-pre-line">{String(value)}</bdi>;
}

/** The assessor guide, as MIDAN stored it. Staff only: the API never sends it to a candidate. */
export function AssessorGuide({ guide }: { guide: null | { standard_version: string; content: Record<string, unknown>; updated_at: string } }) {
  const t = useTranslations('assessmentIntel');
  if (!guide) return null;
  return (
    <details className="rounded-lg border border-gold p-4 text-sm">
      <summary className="cursor-pointer font-semibold">{t('guideTitle', { version: guide.standard_version })}</summary>
      <p className="mt-2 font-semibold text-error">{t('guideAssessorOnly')}</p>
      <div className="mt-3"><Value value={guide.content} /></div>
    </details>
  );
}

type Material = {
  id: string; title_ar: string; title_en: string; kind: string; provenance?: string; description_ar?: string; description_en?: string;
  columns?: { name: string; meaning_ar?: string; meaning_en?: string; unit?: string }[]; rows?: Record<string, unknown>[];
  content_ar?: string | null; content_en?: string | null; row_count?: number | null;
};
export type CandidatePackage = null | {
  candidate_brief?: { company_context_ar?: string; company_context_en?: string; objective_ar?: string; objective_en?: string; rules_ar?: string[]; rules_en?: string[]; tools_ar?: string[]; tools_en?: string[] };
  materials?: Material[];
};

const ROWS_SHOWN = 50;

/** What the candidate works from: the brief and the materials. Candidate-facing only; nothing here is assessor material. */
export function CandidateMaterials({ pkg }: { pkg: CandidatePackage }) {
  const t = useTranslations('assessmentIntel');
  const locale = useLocale();
  const brief = pkg?.candidate_brief;
  const materials = pkg?.materials ?? [];
  const list = (ar?: string[], en?: string[]) => (locale === 'ar' ? (ar?.length ? ar : en) : (en?.length ? en : ar)) ?? [];
  if (!brief && materials.length === 0) return null;
  return (
    <div className="mb-6 space-y-5">
      {brief && (
        <div className="space-y-2">
          {pick(locale, brief.company_context_ar ?? '', brief.company_context_en ?? '') && <p className="leading-relaxed">{pick(locale, brief.company_context_ar ?? '', brief.company_context_en ?? '')}</p>}
          {pick(locale, brief.objective_ar ?? '', brief.objective_en ?? '') && <p><span className="font-semibold">{t('objective')}: </span>{pick(locale, brief.objective_ar ?? '', brief.objective_en ?? '')}</p>}
          {list(brief.rules_ar, brief.rules_en).length > 0 && <div><p className="font-semibold">{t('rules')}</p><ul className="list-disc ps-5">{list(brief.rules_ar, brief.rules_en).map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          {list(brief.tools_ar, brief.tools_en).length > 0 && <p><span className="font-semibold">{t('tools')}: </span>{list(brief.tools_ar, brief.tools_en).join(locale === 'ar' ? '، ' : ', ')}</p>}
        </div>
      )}
      {materials.length > 0 && (
        <div>
          <h2 className="subsection-title">{t('materials')}</h2>
          <ul className="mt-2 space-y-4">
            {materials.map((m) => (
              <li key={m.id} className="rounded-lg border border-border p-3">
                <p className="font-semibold">{pick(locale, m.title_ar, m.title_en)} <span className="text-xs font-normal text-muted">· {t(`materialKind.${['table', 'log', 'document', 'policy'].includes(m.kind) ? m.kind : 'document'}`)}{m.provenance === 'fictional' && ` · ${t('fictional')}`}</span></p>
                {pick(locale, m.description_ar ?? '', m.description_en ?? '') && <p className="mt-1 text-sm text-muted">{pick(locale, m.description_ar ?? '', m.description_en ?? '')}</p>}
                {pick(locale, m.content_ar ?? '', m.content_en ?? '') && <p className="mt-2 text-sm whitespace-pre-line">{pick(locale, m.content_ar ?? '', m.content_en ?? '')}</p>}
                {(m.columns ?? []).length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-start text-sm">
                      <thead className="border-b border-border">
                        <tr>{m.columns!.map((c) => <th key={c.name} className="py-1.5 pe-3 text-start font-semibold" title={pick(locale, c.meaning_ar ?? '', c.meaning_en ?? '')}><bdi dir="ltr">{c.name}</bdi>{c.unit && <span className="text-muted"> ({c.unit})</span>}</th>)}</tr>
                      </thead>
                      <tbody>
                        {(m.rows ?? []).slice(0, ROWS_SHOWN).map((row, i) => (
                          <tr key={i} className="border-b border-border">{m.columns!.map((c) => <td key={c.name} className="py-1 pe-3 tabular-nums"><bdi>{String(row[c.name] ?? '')}</bdi></td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                    {(m.rows ?? []).length > ROWS_SHOWN && <p className="mt-1 text-xs text-muted">{t('rowsShown', { shown: ROWS_SHOWN, total: (m.rows ?? []).length })}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
