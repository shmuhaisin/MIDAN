'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import {
  acceptJobAnalysis, addCustomSkill, analyzeJob, type CatalogSkill, dismissJobAnalysis, linkJobSkill, removeCustomSkill, removeJobSkill,
  searchReferenceSkills, suggestJobSkills, updateCustomSkill, updateJobSkill,
} from '@/lib/actions';
import type { FormState } from '@/lib/auth-actions';
import { ActionForm, ErrorText, Field, INPUT, PRIMARY, Submit } from './forms';

export type Proposal = {
  reference_skill_id: string; name_ar: string; sector_code: string; basis: 'mentioned' | 'family' | 'ai' | 'similar'; evidence: string | null;
  required: boolean; is_priority: boolean | null; source: { file: string; sheet: string; row: number };
  reason_en?: string | null; reason_ar?: string | null; level?: number | null; score?: number | null;
};
export type Analysis = {
  id: string; method?: string; status: 'proposed' | 'accepted' | 'dismissed'; sector_code: string | null; confidence: string | null;
  job_family_ar: string | null; subsector_ar: string | null; proposals: Proposal[];
};
export type CustomSkill = { id: string; name_ar: string | null; name_en: string | null; description: string | null; is_required: boolean; required_level: number | null };
type Linked = { is_required: boolean; required_level?: number | null; reference_skills: { id: string; name_ar: string; sector_code: string } };

/** L1–L4 on MIDAN's scale, or not set. L0 ("no valid evidence") describes a result, never an expectation. */
function LevelSelect({ value, onChange, disabled, label }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; label: string }) {
  const t = useTranslations('jobAnalysis');
  const scale = useTranslations('how').raw('scale') as { code: string; name: string }[];
  return (
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className={`${INPUT} h-9 w-auto py-0 text-sm`}>
      <option value="">{t('levelNotSet')}</option>
      {scale.slice(1).map((s, i) => <option key={s.code} value={i + 1}>{s.code} · {s.name}</option>)}
    </select>
  );
}

/**
 * The job's skills, decided by the employer. Suggestions read the job's own text: by meaning (and chosen by the AI model
 * when it is available), or by the workbook names it contains. Nothing changes until the employer accepts. Workbook skills
 * can also be found by search, and the employer can add their own skills for this job. Each skill is required or preferred,
 * with an expected level. The accepted list feeds the match candidates see and the assessment draft.
 */
export function JobAnalysisPanel({ orgId, jobId, analysis, linked, custom, canEdit }: {
  orgId: string; jobId: string; analysis: Analysis | null; linked: Linked[]; custom: CustomSkill[]; canEdit: boolean;
}) {
  const t = useTranslations('jobAnalysis');
  const ts = useTranslations('admin.listings.sectors');
  const locale = useLocale();
  const proposals = analysis?.proposals ?? [];
  const isSuggestion = (p: Proposal) => p.basis === 'ai' || p.basis === 'similar';
  const [chosen, setChosen] = useState(() => new Set(proposals.filter((p) => p.basis === 'mentioned' || p.basis === 'ai').map((p) => p.reference_skill_id)));
  const [required, setRequired] = useState(() => new Set(proposals.filter((p) => p.required).map((p) => p.reference_skill_id)));
  const [levels, setLevels] = useState<Record<string, number | null>>(() => Object.fromEntries(proposals.map((p) => [p.reference_skill_id, p.level ?? null])));
  const [setSector, setSetSector] = useState(true);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'suggest' | 'analyze' | null>(null);
  const [error, setError] = useState<string>();
  const run = (work: () => Promise<{ error?: string }>) => start(async () => setError((await work()).error));
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    update(next);
  };
  const sector = (code: string | null) => (code && ts.has(code) ? ts(code) : code ?? t('noSector'));
  const reason = (p: Proposal) => (locale === 'ar' ? p.reason_ar ?? p.reason_en : p.reason_en ?? p.reason_ar);
  const why = (p: Proposal) => {
    if (p.basis === 'mentioned') return t('mentioned', { words: p.evidence ?? '' });
    if (p.basis === 'family') return t('fromFamily', { family: p.evidence ?? '' });
    if (p.basis === 'ai') return reason(p) ?? '';
    return t('similar', { score: p.score != null ? Number(p.score).toFixed(2) : '–' });
  };

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">{t('leadAll')}</p>

      <section aria-labelledby="linked-skills" className="space-y-2">
        <h3 id="linked-skills" className="text-sm font-semibold">{t('linked', { count: linked.length + custom.length })}</h3>
        {linked.length + custom.length === 0 ? <p className="text-sm text-muted">{t('noneLinked')}</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {linked.map((l) => (
              <li key={l.reference_skills.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 font-medium" dir="rtl"><bdi>{l.reference_skills.name_ar}</bdi>
                  <span className="ms-2 text-xs font-normal text-muted">{t('fromWorkbooks')}</span></span>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={l.is_required} disabled={!canEdit || pending}
                    onChange={(e) => run(() => updateJobSkill(orgId, jobId, l.reference_skills.id, { is_required: e.target.checked }))} />
                  {t('required')}
                </label>
                <LevelSelect label={t('levelFor', { skill: l.reference_skills.name_ar })} value={l.required_level ?? null} disabled={!canEdit || pending}
                  onChange={(v) => run(() => updateJobSkill(orgId, jobId, l.reference_skills.id, { required_level: v }))} />
                {canEdit && <button type="button" disabled={pending} className="text-sm text-muted underline underline-offset-4"
                  aria-label={t('removeNamed', { skill: l.reference_skills.name_ar })}
                  onClick={() => run(() => removeJobSkill(orgId, jobId, l.reference_skills.id))}>{t('remove')}</button>}
              </li>
            ))}
            {custom.map((c) => {
              const name = locale === 'ar' ? c.name_ar ?? c.name_en : c.name_en ?? c.name_ar;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 font-medium"><bdi>{name}</bdi>
                    <span className="ms-2 text-xs font-normal text-muted">{t('employerSkill')}</span>
                    {c.description && <span className="block text-xs font-normal text-muted">{c.description}</span>}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={c.is_required} disabled={!canEdit || pending}
                      onChange={(e) => run(() => updateCustomSkill(orgId, jobId, c.id, { is_required: e.target.checked }))} />
                    {t('required')}
                  </label>
                  <LevelSelect label={t('levelFor', { skill: name ?? '' })} value={c.required_level} disabled={!canEdit || pending}
                    onChange={(v) => run(() => updateCustomSkill(orgId, jobId, c.id, { required_level: v }))} />
                  {canEdit && <button type="button" disabled={pending} className="text-sm text-muted underline underline-offset-4"
                    aria-label={t('removeNamed', { skill: name ?? '' })} onClick={() => run(() => removeCustomSkill(orgId, jobId, c.id))}>{t('remove')}</button>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">{t('levelsNote')}</p>
      </section>

      {analysis?.status === 'proposed' ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">
            {analysis.method === 'ai_suggestions_v1' ? t('aiResult') : analysis.method === 'semantic_similarity_v1' ? t('similarResult') : t('result', { sector: sector(analysis.sector_code) })}
            {analysis.job_family_ar && ` · ${t('family', { family: analysis.job_family_ar })}`}
            {analysis.confidence && ` · ${t('confidence', { value: Number(analysis.confidence).toFixed(2) })}`}
          </p>
          {analysis.method === 'semantic_similarity_v1' && <p role="note" className="callout text-sm">{t('similarNote')}</p>}
          {proposals.length === 0 ? <p className="text-sm text-muted">{t('noProposals')}</p> : (
            <ul className="divide-y divide-border">
              {proposals.map((p) => (
                <li key={p.reference_skill_id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={chosen.has(p.reference_skill_id)} disabled={!canEdit}
                      onChange={() => toggle(chosen, p.reference_skill_id, setChosen)} />
                    <span>
                      <span className="font-medium" dir="rtl"><bdi>{p.name_ar}</bdi></span>
                      <span className="block text-xs text-muted" dir="auto">
                        {why(p)}{' · '}{p.source.file}, {p.source.sheet}, {t('row', { row: p.source.row })}
                      </span>
                    </span>
                  </label>
                  <span className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={required.has(p.reference_skill_id)} disabled={!canEdit || !chosen.has(p.reference_skill_id)}
                        onChange={() => toggle(required, p.reference_skill_id, setRequired)} />
                      {t('required')}
                    </label>
                    {isSuggestion(p) && (
                      <LevelSelect label={t('levelFor', { skill: p.name_ar })} value={levels[p.reference_skill_id] ?? null}
                        disabled={!canEdit || !chosen.has(p.reference_skill_id)} onChange={(v) => setLevels((all) => ({ ...all, [p.reference_skill_id]: v }))} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <>
              {analysis.sector_code && !analysis.method?.startsWith('ai_') && !analysis.method?.startsWith('semantic_') && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={setSector} onChange={(e) => setSetSector(e.target.checked)} />
                  {t('setSector', { sector: sector(analysis.sector_code) })}
                </label>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={pending || chosen.size === 0} className={PRIMARY}
                  onClick={() => run(() => acceptJobAnalysis(orgId, jobId, analysis.id, [...chosen], [...required].filter((id) => chosen.has(id)),
                    setSector && !analysis.method?.startsWith('ai_') && !analysis.method?.startsWith('semantic_'),
                    Object.fromEntries([...chosen].filter((id) => id in levels).map((id) => [id, levels[id]]))))}>
                  {t('accept', { count: chosen.size })}
                </button>
                <button type="button" disabled={pending} className="text-sm text-muted underline underline-offset-4"
                  onClick={() => run(() => dismissJobAnalysis(orgId, jobId, analysis.id))}>{t('dismiss')}</button>
              </div>
            </>
          )}
        </div>
      ) : canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending} aria-busy={busy === 'suggest'} className={PRIMARY}
            onClick={() => { setBusy('suggest'); run(async () => { const r = await suggestJobSkills(orgId, jobId); setBusy(null); return r; }); }}>
            {busy === 'suggest' ? t('suggesting') : t('suggest')}
          </button>
          <button type="button" disabled={pending} onClick={() => { setBusy('analyze'); run(async () => { const r = await analyzeJob(orgId, jobId); setBusy(null); return r; }); }}
            className="btn btn-secondary btn-sm">
            {busy === 'analyze' ? t('analyzing') : analysis ? t('analyzeAgain') : t('analyze')}
          </button>
        </div>
      )}
      <ErrorText code={error} />

      {canEdit && <CatalogSearch orgId={orgId} jobId={jobId} linkedIds={new Set(linked.map((l) => l.reference_skills.id))} />}
      {canEdit && <CustomSkillForm orgId={orgId} jobId={jobId} />}
    </div>
  );
}

function CatalogSearch({ orgId, jobId, linkedIds }: { orgId: string; jobId: string; linkedIds: Set<string> }) {
  const t = useTranslations('jobAnalysis');
  const ts = useTranslations('admin.listings.sectors');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CatalogSkill[] | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="catalog-search" className="space-y-2">
      <h3 id="catalog-search" className="text-sm font-semibold">{t('searchTitle')}</h3>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await searchReferenceSkills(orgId, q); setItems(r.items ?? []); setError(r.error); }); }}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('searchLabel')}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} dir="auto" minLength={2} maxLength={100} className={INPUT} />
        </label>
        <button type="submit" disabled={pending || q.trim().length < 2} className="btn btn-secondary btn-sm">{t('search')}</button>
      </form>
      <ErrorText code={error} />
      {items && (items.length === 0 ? <p className="text-sm text-muted">{t('searchNone')}</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0"><bdi className="font-medium" dir="rtl">{s.name_ar}</bdi>
                <span className="ms-2 text-xs text-muted">{ts.has(s.sector_code) ? ts(s.sector_code) : s.sector_code}</span></span>
              {linkedIds.has(s.id) ? <span className="text-xs text-muted">{t('alreadyLinked')}</span> : (
                <button type="button" disabled={pending} className="text-sm font-semibold underline underline-offset-4"
                  aria-label={t('addNamed', { skill: s.name_ar })}
                  onClick={() => start(async () => { const r = await linkJobSkill(orgId, jobId, s.id, false, null); setError(r.error); })}>{t('add')}</button>
              )}
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}

function CustomSkillForm({ orgId, jobId }: { orgId: string; jobId: string }) {
  const t = useTranslations('jobAnalysis');
  const scale = useTranslations('how').raw('scale') as { code: string; name: string }[];
  const [state, action] = useActionState<FormState, FormData>(addCustomSkill.bind(null, orgId, jobId), {});
  return (
    <section aria-labelledby="custom-skill" className="space-y-2">
      <h3 id="custom-skill" className="text-sm font-semibold">{t('customTitle')}</h3>
      <p className="text-xs text-muted">{t('customLead')}</p>
      <ActionForm action={action} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
        <ErrorText code={state.error} />
        <Field name="name_ar" dir="rtl" maxLength={200} label={t('nameAr')} />
        <Field name="name_en" dir="ltr" maxLength={200} label={t('nameEn')} />
        <Field name="description" dir="auto" maxLength={1000} label={t('description')} className="sm:col-span-2" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_required" />{t('required')}</label>
        <label className="text-sm">
          <span className="field-label">{t('expectedLevel')}</span>
          <select name="required_level" defaultValue="" className={`${INPUT} h-10`}>
            <option value="">{t('levelNotSet')}</option>
            {scale.slice(1).map((s, i) => <option key={s.code} value={i + 1}>{s.code} · {s.name}</option>)}
          </select>
        </label>
        <div className="sm:col-span-2"><Submit>{t('addCustom')}</Submit></div>
      </ActionForm>
    </section>
  );
}
