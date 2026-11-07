'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import {
  addEmployerAlias, addLearningResource, adminClaimEvidenceLink, convertListing, importListings, linkOrganizationEmployer, previewListings, reviewEmployerClaim, resolveImportRecord, retryBackgroundJob, reviewListing, searchReferenceSkills, setPlatformAdmin,
} from '@/lib/admin-actions';
import type { ListingPreview } from '@/lib/admin-actions';
import { ErrorText, INPUT, openFileLink, PRIMARY, useAction } from './forms';

const SECTIONS = [
  ['', 'overview'], ['/review', 'review'], ['/imports', 'imports'], ['/employers', 'employers'], ['/listings', 'listings'], ['/claims', 'claims'],
  ['/reference', 'reference'], ['/learning', 'learning'], ['/accounts', 'accounts'], ['/queue', 'queue'], ['/audit', 'audit'],
] as const;

export function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  return (
    <nav aria-label={t('label')} className="border-b border-border">
      <ul className="flex gap-1 overflow-x-auto">
        {SECTIONS.map(([path, key]) => {
          const href = `/admin${path}`;
          const current = path === '' ? pathname === '/admin' : pathname.startsWith(href);
          return (
            <li key={key} className="shrink-0">
              <Link href={href} aria-current={current ? 'page' : undefined}
                className={clsx('inline-block border-b-2 px-3 py-2.5 text-sm transition-colors hover:text-foreground', current ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted')}>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const LINK_BUTTON = 'text-sm font-semibold underline underline-offset-4 disabled:opacity-60';

export function RecordActions({ id }: { id: number }) {
  const t = useTranslations('admin.review');
  const accept = useAction(() => resolveImportRecord(id, 'accepted'));
  const dismiss = useAction(() => resolveImportRecord(id, 'dismissed'));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={accept.fire} disabled={accept.pending || dismiss.pending} className={clsx(LINK_BUTTON, 'text-primary')}>{t('accept')}</button>
      <button type="button" onClick={dismiss.fire} disabled={accept.pending || dismiss.pending} className={clsx(LINK_BUTTON, 'text-muted')}>{t('dismiss')}</button>
      <ErrorText code={accept.error ?? dismiss.error} />
    </div>
  );
}

type Candidate = { id: string; name_ar: string; name_en: string };

export function ListingActions({ id, matchStatus, reviewStatus, published, duplicate, candidates, registryId, jobId }: {
  id: string; matchStatus: string; reviewStatus: string; published: boolean; duplicate: boolean; candidates: Candidate[]; registryId: string | null; jobId?: string | null;
}) {
  const t = useTranslations('admin.listings');
  const [choice, setChoice] = useState(registryId ?? candidates[0]?.id ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const act = (action: string, registry?: string) => start(async () => setError((await reviewListing(id, action, registry)).error));
  const confirmed = ['matched', 'confirmed'].includes(matchStatus);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {!confirmed && candidates.length > 0 && (
          <label className="flex min-w-0 max-w-full items-center gap-2 text-sm">
            <span className="sr-only">{t('chooseEmployer')}</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} className="h-9 w-full min-w-0 max-w-full truncate rounded-lg border border-border bg-surface px-2 sm:w-auto sm:max-w-md">
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name_ar} · {c.name_en}</option>)}
            </select>
          </label>
        )}
        {!confirmed && (choice || registryId) && (
          <button type="button" disabled={pending} onClick={() => act('confirm_employer', choice || undefined)} className={clsx(LINK_BUTTON, 'text-primary')}>{t('confirmEmployer')}</button>
        )}
        {matchStatus !== 'rejected' && <button type="button" disabled={pending} onClick={() => act('reject_employer')} className={LINK_BUTTON}>{t('rejectEmployer')}</button>}
        {reviewStatus !== 'approved' && <button type="button" disabled={pending} onClick={() => act('approve')} className={clsx(LINK_BUTTON, 'text-primary')}>{t('approve')}</button>}
        {reviewStatus !== 'rejected' && <button type="button" disabled={pending} onClick={() => act('reject')} className={clsx(LINK_BUTTON, 'text-muted')}>{t('reject')}</button>}
        {duplicate && <button type="button" disabled={pending} onClick={() => act('not_duplicate')} className={LINK_BUTTON}>{t('notDuplicate')}</button>}
        {reviewStatus === 'approved' && confirmed && !duplicate && !published && (
          <button type="button" disabled={pending} onClick={() => act('publish')} className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{t('publish')}</button>
        )}
        {published && <button type="button" disabled={pending} onClick={() => act('unpublish')} className={LINK_BUTTON}>{t('unpublish')}</button>}
        {reviewStatus === 'approved' && confirmed && !duplicate && !jobId && (
          <button type="button" disabled={pending} onClick={() => start(async () => setError((await convertListing(id)).error))} className={clsx(LINK_BUTTON, 'text-primary')}>{t('convert')}</button>
        )}
        {jobId && <span className="text-sm text-muted">{t('converted')}</span>}
      </div>
      <ErrorText code={error} />
    </div>
  );
}

export function AliasForm({ registryId }: { registryId: string }) {
  const t = useTranslations('admin.employers');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const { pending, error, fire } = useAction(async () => {
    const result = await addEmployerAlias(registryId, name, language);
    if (result.ok) setName('');
    return result;
  });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <label className="block min-w-48 flex-1">
        <span className="text-sm font-medium">{t('aliasName')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={300} className={INPUT} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t('aliasLanguage')}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')} className={INPUT}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className="min-h-11 rounded-full border border-foreground/30 px-4 text-sm font-semibold disabled:opacity-60">{t('addAlias')}</button>
      <div className="w-full"><ErrorText code={error} /></div>
    </form>
  );
}

export function AdminGrantForm() {
  const t = useTranslations('admin.accounts');
  const [email, setEmail] = useState('');
  const [grant, setGrant] = useState(true);
  const { pending, error, fire } = useAction(async () => {
    const result = await setPlatformAdmin(email, grant);
    if (result.ok) setEmail('');
    return result;
  });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <label className="block min-w-60 flex-1">
        <span className="text-sm font-medium">{t('email')}</span>
        <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required className={INPUT} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t('change')}</span>
        <select value={grant ? 'grant' : 'revoke'} onChange={(e) => setGrant(e.target.value === 'grant')} className={INPUT}>
          <option value="grant">{t('grant')}</option>
          <option value="revoke">{t('revoke')}</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className={PRIMARY}>{t('apply')}</button>
      <div className="w-full"><ErrorText code={error} /></div>
    </form>
  );
}

export function RetryJobButton({ id }: { id: string }) {
  const t = useTranslations('admin.queue');
  const { pending, error, fire } = useAction(() => retryBackgroundJob(id));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={fire} disabled={pending} className={clsx(LINK_BUTTON, 'text-primary')}>{t('retry')}</button>
      <ErrorText code={error} />
    </span>
  );
}

export function ResourceForm() {
  const t = useTranslations('admin.learning');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ id: string; name_ar: string; sector_code: string }[]>([]);
  const [skill, setSkill] = useState<{ id: string; name_ar: string } | null>(null);
  const [searching, startSearch] = useTransition();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    const form = new FormData(target);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    start(async () => {
      const result = await addLearningResource({
        kind: value('kind') as 'course' | 'certification', title_ar: value('title_ar') || undefined, title_en: value('title_en') || undefined,
        provider: value('provider'), url: value('url'), verified_on: value('verified_on'), reference_skill_id: skill?.id ?? '',
      });
      setError(result.error);
      setSaved(Boolean(result.ok));
      if (result.ok) { target.reset(); setSkill(null); }
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="section-title">{t('add')}</h2>
      <p className="text-sm text-muted">{t('rule')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="text-sm font-medium">{t('kind')}</span>
          <select name="kind" className={INPUT}><option value="course">{t('course')}</option><option value="certification">{t('certification')}</option></select>
        </label>
        <label className="block"><span className="text-sm font-medium">{t('provider')}</span><input name="provider" required maxLength={120} className={INPUT} /></label>
        <label className="block"><span className="text-sm font-medium">{t('titleAr')}</span><input name="title_ar" maxLength={300} className={INPUT} /></label>
        <label className="block"><span className="text-sm font-medium">{t('titleEn')}</span><input name="title_en" dir="ltr" maxLength={300} className={INPUT} /></label>
        <label className="block"><span className="text-sm font-medium">{t('url')}</span><input name="url" type="url" dir="ltr" required pattern="https://.+" className={INPUT} /></label>
        <label className="block"><span className="text-sm font-medium">{t('verifiedOn')}</span><input name="verified_on" type="date" required className={INPUT} /></label>
      </div>
      <div>
        <label className="block"><span className="text-sm font-medium">{t('skill')}</span>
          <input value={query} onChange={(e) => {
            setQuery(e.target.value);
            const q = e.target.value;
            startSearch(async () => setMatches(await searchReferenceSkills(q)));
          }} className={INPUT} aria-describedby="skill-chosen" />
        </label>
        <p id="skill-chosen" className="mt-1 text-sm">{skill ? t('chosen', { name: skill.name_ar }) : t('noneChosen')}</p>
        {matches.length > 0 && (
          <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border" aria-busy={searching}>
            {matches.slice(0, 12).map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => { setSkill(m); setMatches([]); setQuery(''); }} className="block w-full px-3 py-2 text-start text-sm hover:bg-surface-2">
                  {m.name_ar} <span className="text-muted">· {m.sector_code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ErrorText code={error} />
      {saved && <p role="status" className="text-sm font-semibold text-primary">{t('saved')}</p>}
      <button type="submit" disabled={pending} className={PRIMARY}>{t('save')}</button>
    </form>
  );
}

export function EmployerLinkForm({ orgId, current, employers }: { orgId: string; current: string | null; employers: { id: string; source_company_id: string; name_ar: string; name_en: string }[] }) {
  const t = useTranslations('admin.accounts');
  const [value, setValue] = useState(current ?? '');
  const { pending, error, fire } = useAction(() => linkOrganizationEmployer(orgId, value || null));
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); fire(); }}>
      <label className="min-w-0 max-w-full">
        <span className="sr-only">{t('employerLink')}</span>
        <select value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-full min-w-0 max-w-64 truncate rounded-lg border border-border bg-surface px-2 text-sm">
          <option value="">{t('noLink')}</option>
          {employers.map((e) => <option key={e.id} value={e.id}>{e.source_company_id} · {e.name_ar}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending || value === (current ?? '')} className="text-sm font-semibold text-primary underline underline-offset-4 disabled:opacity-50">{t('link')}</button>
      <ErrorText code={error} />
    </form>
  );
}

const UPLOAD_STATUSES = ['new', 'update', 'unchanged', 'duplicate_in_file', 'cross_source_duplicate', 'invalid'];

/** Upload, see exactly what would happen, then save that same file. Nothing is saved or published by the preview. */
export function ListingUpload() {
  const t = useTranslations('admin.upload');
  const ts = useTranslations('admin.listings');
  const [form, setForm] = useState<FormData>();
  const [preview, setPreview] = useState<ListingPreview>();
  const [saved, setSaved] = useState<{ run_id: string; counts: Record<string, number>; rejected: number; repeated: number }>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const reset = () => { setPreview(undefined); setSaved(undefined); setError(undefined); };
  const save = () => start(async () => {
    if (!form || !preview) return;
    const data = new FormData();
    form.forEach((value, key) => data.append(key, value));
    data.set('preview_sha256', preview.sha256);
    const outcome = await importListings(data);
    setError(outcome.error);
    if (outcome.saved) { setSaved(outcome.saved); setPreview(undefined); }
  });
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">{t('title')}</summary>
      <p className="mt-2 text-sm text-muted">{t('lead')}</p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onChange={reset}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setForm(data);
          reset();
          start(async () => {
            const outcome = await previewListings(data);
            setError(outcome.error);
            setPreview(outcome.preview);
          });
        }}
      >
        <label className="block text-sm font-medium">{t('sourceType')}
          <select name="source_type" aria-label={t('sourceType')} required className={INPUT} defaultValue="employer_provided">
            {['employer_provided', 'employer_career_site', 'other_authorized'].map((k) => <option key={k} value={k}>{t(`sourceTypes.${k}`)}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">{t('sourceName')}
          <input name="source_name" required minLength={2} maxLength={200} className={INPUT} />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">{t('authorization')}
          <textarea name="authorization_note" aria-label={t('authorization')} required minLength={5} maxLength={1000} rows={2} className={clsx(INPUT, 'h-auto py-2')} />
          <span className="mt-1 block text-xs font-normal text-muted">{t('authorizationHint')}</span>
        </label>
        <label className="block text-sm font-medium sm:col-span-2">{t('file')}
          <input name="file" type="file" aria-label={t('file')} required accept=".csv,.json,text/csv,application/json" className="mt-1 block w-full text-sm" />
          <span className="mt-1 block text-xs font-normal text-muted">{t('fileHint')}</span>
        </label>
        <div className="sm:col-span-2"><button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('previewButton')}</button></div>
      </form>
      <div className="mt-3"><ErrorText code={error} /></div>
      {preview && (
        <div className="mt-4 space-y-3" data-testid="listing-preview">
          <p role="status" className="font-semibold">{t('summary', { file: preview.file, total: preview.total })}</p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {UPLOAD_STATUSES.filter((k) => preview.counts[k]).map((k) => <li key={k} className="rounded-full border border-border px-3 py-1">{t(`status.${k}`)}: <span className="tabular-nums font-semibold">{preview.counts[k]}</span></li>)}
          </ul>
          {preview.missing_columns.length > 0 && <p role="alert" className="text-sm text-error">{t('missingColumns', { columns: preview.missing_columns.join('، ') })}</p>}
          {preview.unknown_columns.length > 0 && <p className="text-sm text-muted">{t('unknownColumns', { columns: preview.unknown_columns.join('، ') })}</p>}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[40rem] text-start text-sm">
              <caption className="sr-only">{t('summary', { file: preview.file, total: preview.total })}</caption>
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>{[t('row'), t('jobTitle'), t('employer'), t('result')].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="px-3 py-2 tabular-nums">{r.row}</td>
                    <td dir="auto" className="px-3 py-2">{r.title ?? '—'}</td>
                    <td className="px-3 py-2"><span dir="auto">{r.employer ?? '—'}</span>{r.match_status && <span className="block text-xs text-muted">{ts(`match.${r.match_status}`)}{r.registry_name_ar && ` · ${r.registry_name_ar}`}</span>}</td>
                    <td className="px-3 py-2">
                      <span className={r.status === 'invalid' ? 'font-semibold text-error' : 'font-semibold'}>{t(`status.${r.status}`)}</span>
                      {[...r.errors, ...r.warnings].map((code) => <span key={code} className="block text-xs text-muted">{t(`problem.${code}`)}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">{t('saveNote')}</p>
          <button type="button" disabled={pending || !preview.can_import} aria-busy={pending} onClick={save} className={PRIMARY}>{t('saveButton')}</button>
        </div>
      )}
      {saved && (
        <p role="status" className="mt-4 rounded-lg bg-accent p-3 text-sm font-medium text-accent-foreground">
          {t('saved')} <Link href={`/admin/imports/${saved.run_id}`} className="underline underline-offset-4">{t('openRun')}</Link>
        </p>
      )}
    </details>
  );
}

export type AdminClaim = {
  id: string; role_title: string; evidence_note: string; has_evidence: boolean; email_domain_matches: boolean; status: string; review_note: string | null;
  org_name_ar: string; org_name_en: string; is_test: boolean; employer_name_ar: string; employer_name_en: string; source_company_id: string; official_website: string | null; requested_by_email: string | null;
};

export function ClaimReview({ claim }: { claim: AdminClaim }) {
  const t = useTranslations('admin.claims');
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const decide = (decision: 'approved' | 'rejected') => start(async () => setError((await reviewEmployerClaim(claim.id, decision, note)).error));
  return (
    <div className="space-y-2">
      {claim.has_evidence && (
        <button type="button" onClick={() => start(() => openFileLink(() => adminClaimEvidenceLink(claim.id), setError))} className="text-sm font-semibold text-primary underline underline-offset-4">{t('openEvidence')}</button>
      )}
      {claim.status === 'pending' && (
        <>
          <label className="block text-sm font-medium">{t('note')}
            <textarea aria-label={t('note')} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={clsx(INPUT, 'h-auto py-2')} />
            <span className="mt-1 block text-xs font-normal text-muted">{t('noteHint')}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending} onClick={() => decide('approved')} className={PRIMARY}>{t('approve')}</button>
            <button type="button" disabled={pending} onClick={() => decide('rejected')} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">{t('reject')}</button>
          </div>
        </>
      )}
      <ErrorText code={error} />
    </div>
  );
}
