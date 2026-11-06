'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import {
  addEmployerAlias, addLearningResource, resolveImportRecord, retryBackgroundJob, reviewListing, searchReferenceSkills, setPlatformAdmin,
} from '@/lib/admin-actions';
import { ErrorText, INPUT, PRIMARY, useAction } from './forms';

const SECTIONS = [
  ['', 'overview'], ['/review', 'review'], ['/imports', 'imports'], ['/employers', 'employers'], ['/listings', 'listings'],
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

export function ListingActions({ id, matchStatus, reviewStatus, published, duplicate, candidates, registryId }: {
  id: string; matchStatus: string; reviewStatus: string; published: boolean; duplicate: boolean; candidates: Candidate[]; registryId: string | null;
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
