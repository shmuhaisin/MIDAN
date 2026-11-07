'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  acceptInvitation, changeMemberRole, claimEvidenceLink, convertOrganizationListing, declineInvitation, inviteMember, removeMember, revokeInvitation, submitEmployerClaim, withdrawEmployerClaim,
} from '@/lib/actions';
import { formatDate, pick } from '@/lib/format';
import { ErrorText, INPUT, openFileLink, PRIMARY, useAction } from './forms';
import { Badge } from './ui';

export type TeamMember = { user_id: string; email: string; display_name: string | null; role: string; joined_at: string };
export type TeamInvitation = { id: string; email: string; role: string; expires_at: string };
const INVITABLE = ['admin', 'recruiter', 'reviewer'];

function MemberRow({ orgId, member, me, myRole, owners }: { orgId: string; member: TeamMember; me: string; myRole: string; owners: number }) {
  const t = useTranslations('team');
  const roles = useTranslations('dashboard.role');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  // An admin doesn't manage owners or make new ones, and an organization always keeps an owner.
  const canEdit = myRole === 'owner' ? !(member.role === 'owner' && owners <= 1) : myRole === 'admin' && member.role !== 'owner';
  const options = myRole === 'owner' ? ['owner', ...INVITABLE] : INVITABLE;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{member.display_name || member.email}{member.user_id === me && <span className="ms-2 text-sm font-normal text-muted">{t('you')}</span>}</p>
        <p dir="ltr" className="truncate text-start text-sm text-muted">{member.email}</p>
        <ErrorText code={error} />
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label={t('roleOf', { name: member.email })} value={member.role} disabled={pending}
            onChange={(e) => { const role = e.target.value; start(async () => setError((await changeMemberRole(orgId, member.user_id, role)).error)); }}
            className="h-10 rounded-lg border border-border bg-surface px-2.5 text-sm"
          >
            {options.map((r) => <option key={r} value={r}>{roles(r)}</option>)}
          </select>
          <button type="button" disabled={pending} onClick={() => start(async () => setError((await removeMember(orgId, member.user_id)).error))} className="text-sm text-muted underline underline-offset-4">{t('remove')}</button>
        </div>
      ) : <Badge>{roles(member.role)}</Badge>}
    </li>
  );
}

export function TeamPanel({ orgId, members, invitations, me, myRole }: { orgId: string; members: TeamMember[]; invitations: TeamInvitation[]; me: string; myRole: string }) {
  const t = useTranslations('team');
  const roles = useTranslations('dashboard.role');
  const locale = useLocale();
  const canManage = ['owner', 'admin'].includes(myRole);
  const owners = members.filter((m) => m.role === 'owner').length;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('recruiter');
  const [sent, setSent] = useState<string>();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="team" className="card">
      <h2 id="team" className="section-title">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('lead')}</p>
      <ul className="mt-3 divide-y divide-border">
        {members.map((m) => <MemberRow key={m.user_id} orgId={orgId} member={m} me={me} myRole={myRole} owners={owners} />)}
      </ul>
      {canManage && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const outcome = await inviteMember(orgId, email, role);
              setError(outcome.error);
              if (!outcome.error) { setSent(email.trim().toLowerCase()); setEmail(''); }
            });
          }}
        >
          <label className="block text-sm font-medium">{t('email')}
            <input type="email" dir="ltr" required value={email} onChange={(e) => { setEmail(e.target.value); setSent(undefined); }} className={INPUT} />
          </label>
          <label className="block text-sm font-medium">{t('role')}
            <select value={role} onChange={(e) => setRole(e.target.value)} className={INPUT}>
              {INVITABLE.map((r) => <option key={r} value={r}>{roles(r)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('invite')}</button>
          <div className="sm:col-span-3">
            <ErrorText code={error} />
            {sent && <p role="status" className="text-sm font-medium">{t('sent', { email: sent })}</p>}
            <p className="mt-1 text-xs text-muted">{t('inviteNote')}</p>
          </div>
        </form>
      )}
      {canManage && invitations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t('pending')}</h3>
          <ul className="mt-2 divide-y divide-border">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span><span dir="ltr">{i.email}</span> · {roles(i.role)} · {t('expires', { date: formatDate(locale, i.expires_at, 'Asia/Riyadh') })}</span>
                <button type="button" onClick={() => start(async () => setError((await revokeInvitation(orgId, i.id)).error))} className="text-muted underline underline-offset-4">{t('revoke')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export type MyInvitation = { id: string; org_id: string; name_ar: string; name_en: string; role: string; expires_at: string };

export function InvitationCard({ invitation }: { invitation: MyInvitation }) {
  const t = useTranslations('invitations');
  const roles = useTranslations('dashboard.role');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <li className="card">
      <h2 className="subsection-title">{pick(locale, invitation.name_ar, invitation.name_en)}</h2>
      <p className="mt-1 text-sm">{t('role', { role: roles(invitation.role) })}</p>
      <p className="text-sm text-muted">{t('expires', { date: formatDate(locale, invitation.expires_at, 'Asia/Riyadh') })}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button" disabled={pending} aria-busy={pending} className={PRIMARY}
          onClick={() => start(async () => {
            const outcome = await acceptInvitation(invitation.id);
            setError(outcome.error);
            if (outcome.org_id) router.push(`/organization/${outcome.org_id}`);
          })}
        >{t('accept')}</button>
        <button type="button" disabled={pending} onClick={() => start(async () => setError((await declineInvitation(invitation.id)).error))} className="font-semibold text-muted underline underline-offset-4">{t('decline')}</button>
      </div>
      <ErrorText code={error} />
    </li>
  );
}

export type OrgClaim = { id: string; registry_id: string; role_title: string; has_evidence: boolean; status: string; review_note: string | null; employer_name_ar: string; employer_name_en: string; created_at: string };
export type RegistryOption = { id: string; name_ar: string; name_en: string; source_company_id: string };

export function EmployerClaimPanel({ orgId, claims, employer, isDemo, options }: {
  orgId: string; claims: OrgClaim[]; employer: { name_ar: string; name_en: string; source_company_id: string } | null; isDemo: boolean; options: RegistryOption[];
}) {
  const t = useTranslations('employerClaim');
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const open = claims.find((c) => c.status === 'pending');
  return (
    <section aria-labelledby="employer-claim" className="card">
      <h2 id="employer-claim" className="section-title">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('lead')}</p>
      {employer && (
        <p role="status" className="mt-3 rounded-lg bg-accent p-3 text-sm font-medium text-accent-foreground">
          {t('managed', { employer: pick(locale, employer.name_ar, employer.name_en) })}
        </p>
      )}
      {employer && <p className="mt-2 text-sm text-muted">{t('notPartnership')}</p>}
      {open && (
        <div className="mt-3 rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">{t('pendingTitle', { employer: pick(locale, open.employer_name_ar, open.employer_name_en) })}</p>
          <p className="mt-1 text-muted">{t('pendingBody')}</p>
          <div className="mt-2 flex flex-wrap gap-4">
            {open.has_evidence && <button type="button" onClick={() => start(() => openFileLink(() => claimEvidenceLink(orgId, open.id), setError))} className="font-semibold text-primary underline underline-offset-4">{t('openEvidence')}</button>}
            <button type="button" disabled={pending} onClick={() => start(async () => setError((await withdrawEmployerClaim(orgId, open.id)).error))} className="text-muted underline underline-offset-4">{t('withdraw')}</button>
          </div>
        </div>
      )}
      {!employer && !open && !isDemo && (
        <form
          ref={formRef} className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            start(async () => {
              const outcome = await submitEmployerClaim(orgId, data);
              setError(outcome.error);
              if (!outcome.error) formRef.current?.reset();
            });
          }}
        >
          <label className="block text-sm font-medium">{t('employer')}
            <select name="registry_id" required defaultValue="" className={INPUT}>
              <option value="" disabled>{t('chooseEmployer')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{pick(locale, o.name_ar, o.name_en)} · {o.source_company_id}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">{t('roleTitle')}
            <input name="role_title" required minLength={2} maxLength={200} dir="auto" className={INPUT} />
          </label>
          <label className="block text-sm font-medium sm:col-span-2">{t('note')}
            <textarea name="evidence_note" required minLength={10} maxLength={4000} rows={3} dir="auto" className={clsx(INPUT, 'h-auto py-2')} />
            <span className="mt-1 block text-xs font-normal text-muted">{t('noteHint')}</span>
          </label>
          <label className="block text-sm font-medium sm:col-span-2">{t('file')}
            <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="mt-1 block w-full text-sm" />
            <span className="mt-1 block text-xs font-normal text-muted">{t('fileHint')}</span>
          </label>
          <div className="sm:col-span-2"><button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>{t('submit')}</button></div>
        </form>
      )}
      <div className="mt-2"><ErrorText code={error} /></div>
      {claims.filter((c) => c.status === 'rejected').slice(0, 1).map((c) => (
        <p key={c.id} className="mt-3 border-s-2 border-gold ps-4 text-sm">
          {t('rejected', { employer: pick(locale, c.employer_name_ar, c.employer_name_en) })}{c.review_note && <span dir="auto" className="block text-muted">{c.review_note}</span>}
        </p>
      ))}
    </section>
  );
}

export type OrgListing = { id: string; title: string; location: string | null; source_name: string; source_url: string; job_id: string | null };

export function OrganizationListingRow({ orgId, listing }: { orgId: string; listing: OrgListing }) {
  const t = useTranslations('org');
  const { pending, error, fire } = useAction(() => convertOrganizationListing(orgId, listing.id));
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p dir="auto" className="font-semibold">{listing.title}</p>
        <p className="text-sm text-muted">{listing.location && `${listing.location} · `}<a href={listing.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{listing.source_name}</a></p>
        <ErrorText code={error} />
      </div>
      {listing.job_id
        ? <Link href={`/organization/${orgId}/jobs/${listing.job_id}`} className="font-semibold text-primary underline underline-offset-4">{t('openJob')}</Link>
        : <button type="button" disabled={pending} aria-busy={pending} onClick={fire} className={PRIMARY}>{t('createDraftJob')}</button>}
    </li>
  );
}
