'use client';
import { useEffect, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { changeMember, sendInvitation, cancelInvitation, type MemberResult } from '@/lib/member-actions';
import { ErrorText, INPUT, PRIMARY } from './forms';

export type Member = { id: string; user_id: string; role: string; display_name: string | null; email: string };
export type Invitation = { id: string; email: string; role: string; created_at: string; expires_at: string; status: 'pending' | 'accepted' | 'expired' };
const roles = ['owner', 'admin', 'recruiter', 'reviewer'];

function Feedback({ result }: { result: MemberResult }) {
  const t = useTranslations('members');
  return <><ErrorText code={result.error} />{result.ok && <p role="status" className="text-sm text-primary">{t('saved')}</p>}</>;
}
function MemberRow({ org, member, myRole, owners }: { org: string; member: Member; myRole: string; owners: number }) {
  const t = useTranslations('members'); const tr = useTranslations('dashboard.role');
  const [role, setRole] = useState(member.role); const [state, setState] = useState<MemberResult>({}); const [pending, start] = useTransition();
  useEffect(() => { setRole(member.role); }, [member.role]);
  const allowed = ['owner', 'admin'].includes(myRole) && (member.role !== 'owner' || (myRole === 'owner' && owners > 1));
  return <li className="space-y-3 border-b border-border py-5" aria-busy={pending}>
    <div><p className="font-semibold">{member.display_name || member.email}</p><p dir="ltr" className="text-sm text-muted">{member.email}</p><p className="text-sm">{tr(member.role)}</p></div>
    {allowed && <div className="flex flex-wrap gap-3">
      <label><span className="text-sm">{t('role')}</span><select aria-label={`${t('role')}: ${member.email}`} className={INPUT} disabled={pending} value={role} onChange={e => setRole(e.target.value)}>{roles.filter(r => r !== 'owner' || myRole === 'owner').map(r => <option key={r} value={r}>{tr(r)}</option>)}</select></label>
      <button className={PRIMARY} disabled={pending || role === member.role} onClick={() => start(async () => setState(await changeMember(org, member.id, role)))}>{pending ? t('working') : t('save')}</button>
      <button className="min-h-12 px-4 text-error underline disabled:opacity-60" disabled={pending} onClick={() => { if (window.confirm(t('confirmRemove', { email: member.email }))) start(async () => setState(await changeMember(org, member.id))); }}>{t('remove')}</button>
    </div>}
    {member.role === 'owner' && owners === 1 && <p className="text-sm text-muted">{t('lastOwner')}</p>}
    <Feedback result={state} />
  </li>;
}
function InvitationRow({ org, invitation }: { org: string; invitation: Invitation }) {
  const t = useTranslations('members'); const tr = useTranslations('dashboard.role'); const locale = useLocale();
  const [state, setState] = useState<MemberResult>({}); const [pending, start] = useTransition();
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <li className="space-y-2 border-b border-border py-5" aria-busy={pending}>
    <p dir="ltr" className="font-semibold">{invitation.email}</p><p>{tr(invitation.role)} · {t(invitation.status)}</p>
    <p className="text-sm text-muted">{t('created')}: {date(invitation.created_at)} · {t('expires')}: {date(invitation.expires_at)}</p>
    {invitation.status !== 'accepted' && <div className="flex flex-wrap gap-3">
      {invitation.status === 'pending' && <button className={PRIMARY} disabled={pending} onClick={() => start(async () => setState(await sendInvitation(org, invitation.id, invitation.email, invitation.role)))}>{pending ? t('working') : t('retryEmail')}</button>}
      <button className="min-h-12 px-4 underline disabled:opacity-60" disabled={pending} onClick={() => { if (window.confirm(t('confirmCancel'))) start(async () => setState(await cancelInvitation(org, invitation.id))); }}>{t('cancel')}</button>
    </div>}
    {state.ok ? <p role="status">{t('actionDone')}</p> : <ErrorText code={state.error} />}
  </li>;
}
export function MembersPanel({ org, members, invitations, myRole }: { org: string; members: Member[]; invitations: Invitation[]; myRole: string }) {
  const t = useTranslations('members'); const tr = useTranslations('dashboard.role');
  const [email, setEmail] = useState(''); const [role, setRole] = useState('recruiter'); const [requestId, setRequestId] = useState('');
  const [state, setState] = useState<MemberResult>({}); const [pending, start] = useTransition(); const manage = ['owner', 'admin'].includes(myRole);
  return <div className="space-y-10">
    <section><h2 className="font-display text-2xl font-bold">{t('members')}</h2>{!members.length && <p>{t('emptyMembers')}</p>}
      <ul>{members.map(member => <MemberRow key={member.id} org={org} member={member} myRole={myRole} owners={members.filter(m => m.role === 'owner').length} />)}</ul>
    </section>
    {manage && <section className="space-y-5"><h2 className="font-display text-2xl font-bold">{t('invite')}</h2><p className="text-muted">{t('sevenDays')}</p>
      <form className="space-y-4" aria-busy={pending} onSubmit={e => { e.preventDefault(); const id = requestId || crypto.randomUUID(); setRequestId(id); start(async () => { const result = await sendInvitation(org, id, email, role); setState(result); if (result.ok) { setEmail(''); setRequestId(''); } }); }}>
        <label className="block">{t('email')}<input className={INPUT} type="email" maxLength={254} required disabled={pending} value={email} dir="ltr" onChange={e => { setEmail(e.target.value); setRequestId(''); setState({}); }} /></label>
        <label className="block">{t('role')}<select className={INPUT} value={role} disabled={pending} onChange={e => { setRole(e.target.value); setRequestId(''); setState({}); }}>{roles.filter(r => r !== 'owner').map(r => <option key={r} value={r}>{tr(r)}</option>)}</select></label>
        <button className={PRIMARY} disabled={pending}>{pending ? t('working') : t('send')}</button>
        <ErrorText code={state.error} />{state.ok && <p role="status">{t('emailAccepted')}</p>}
      </form>
      <h2 className="font-display text-2xl font-bold">{t('invitations')}</h2><p className="text-sm text-muted">{t('deliveryNote')}</p>
      {!invitations.length && <p>{t('emptyInvitations')}</p>}<ul>{invitations.map(i => <InvitationRow key={i.id} org={org} invitation={i} />)}</ul>
    </section>}
  </div>;
}
