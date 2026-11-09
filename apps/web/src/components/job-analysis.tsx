'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { acceptJobAnalysis, analyzeJob, dismissJobAnalysis } from '@/lib/actions';
import { ErrorText, PRIMARY } from './forms';

export type Proposal = {
  reference_skill_id: string; name_ar: string; sector_code: string; basis: 'mentioned' | 'family'; evidence: string | null;
  required: boolean; is_priority: boolean | null; source: { file: string; sheet: string; row: number };
};
export type Analysis = {
  id: string; status: 'proposed' | 'accepted' | 'dismissed'; sector_code: string | null; confidence: string | null;
  job_family_ar: string | null; subsector_ar: string | null; proposals: Proposal[];
};
type Linked = { is_required: boolean; reference_skills: { id: string; name_ar: string; sector_code: string } };

/**
 * Finds what the job's own words name in the seven sector skills workbooks, and proposes skills for the organization to
 * accept. Nothing changes until it does. Accepted skills feed the match shown to candidates and the assessment draft.
 */
export function JobAnalysisPanel({ orgId, jobId, analysis, linked, canEdit }: { orgId: string; jobId: string; analysis: Analysis | null; linked: Linked[]; canEdit: boolean }) {
  const t = useTranslations('jobAnalysis');
  const ts = useTranslations('admin.listings.sectors');
  const proposals = analysis?.proposals ?? [];
  const [chosen, setChosen] = useState(() => new Set(proposals.filter((p) => p.basis === 'mentioned').map((p) => p.reference_skill_id)));
  const [required, setRequired] = useState(() => new Set(proposals.filter((p) => p.required).map((p) => p.reference_skill_id)));
  const [setSector, setSetSector] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (work: () => Promise<{ error?: string }>) => start(async () => setError((await work()).error));
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    update(next);
  };
  const sector = (code: string | null) => (code && ts.has(code) ? ts(code) : code ?? t('noSector'));

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <div>
        <p className="text-sm font-semibold">{t('linked', { count: linked.length })}</p>
        {linked.length === 0 ? <p className="mt-1 text-sm text-muted">{t('noneLinked')}</p> : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {linked.map((l) => (
              <li key={l.reference_skills.id} className="rounded-full border border-border px-3 py-1 text-sm">
                {l.reference_skills.name_ar} <span className="text-muted">· {l.is_required ? t('required') : t('preferred')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {analysis?.status === 'proposed' ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm">
            {t('result', { sector: sector(analysis.sector_code) })}
            {analysis.job_family_ar && ` · ${t('family', { family: analysis.job_family_ar })}`}
            {analysis.confidence && ` · ${t('confidence', { value: Number(analysis.confidence).toFixed(2) })}`}
          </p>
          {proposals.length === 0 ? <p className="text-sm text-muted">{t('noProposals')}</p> : (
            <ul className="divide-y divide-border">
              {proposals.map((p) => (
                <li key={p.reference_skill_id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={chosen.has(p.reference_skill_id)} disabled={!canEdit}
                      onChange={() => toggle(chosen, p.reference_skill_id, setChosen)} />
                    <span>
                      <span className="font-medium">{p.name_ar}</span>
                      <span className="block text-xs text-muted">
                        {p.basis === 'mentioned' ? t('mentioned', { words: p.evidence ?? '' }) : t('fromFamily', { family: p.evidence ?? '' })}
                        {' · '}{p.source.file}, {p.source.sheet}, {t('row', { row: p.source.row })}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={required.has(p.reference_skill_id)} disabled={!canEdit || !chosen.has(p.reference_skill_id)}
                      onChange={() => toggle(required, p.reference_skill_id, setRequired)} />
                    {t('required')}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <>
              {analysis.sector_code && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={setSector} onChange={(e) => setSetSector(e.target.checked)} />
                  {t('setSector', { sector: sector(analysis.sector_code) })}
                </label>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={pending || chosen.size === 0} className={PRIMARY}
                  onClick={() => run(() => acceptJobAnalysis(orgId, jobId, analysis.id, [...chosen], [...required].filter((id) => chosen.has(id)), setSector))}>
                  {t('accept', { count: chosen.size })}
                </button>
                <button type="button" disabled={pending} className="text-sm text-muted underline underline-offset-4"
                  onClick={() => run(() => dismissJobAnalysis(orgId, jobId, analysis.id))}>{t('dismiss')}</button>
              </div>
            </>
          )}
        </div>
      ) : canEdit && (
        <button type="button" disabled={pending} onClick={() => run(() => analyzeJob(orgId, jobId))}
          className="btn btn-secondary btn-sm">
          {pending ? t('analyzing') : analysis ? t('analyzeAgain') : t('analyze')}
        </button>
      )}
      <ErrorText code={error} />
    </div>
  );
}
