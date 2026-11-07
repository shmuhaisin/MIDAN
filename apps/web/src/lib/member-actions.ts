'use server';
import { revalidatePath } from 'next/cache';
import { api, ApiError, errorCode } from './api';
import { getInvitationContext, clearInvitationContext, inspectInvitation, InvitationUnavailable } from './invitation-context';

export type MemberResult = { error?: string; ok?: boolean; orgId?: string };
export async function changeMember(org: string, member: string, role?: string): Promise<MemberResult> {
  try {
    await api(`/organizations/${org}/members/${member}`, { method: role ? 'PATCH' : 'DELETE', ...(role ? { body: { role } } : {}) });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) { return { error: errorCode(error) }; }
}
export async function sendInvitation(org: string, request_id: string, email: string, role: string): Promise<MemberResult> {
  try {
    await api(`/organizations/${org}/invitations`, { method: 'POST', body: { request_id, email, role } });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    // The row may exist even when SMTP failed. Refresh the list and keep its retry ID.
    revalidatePath('/', 'layout');
    return { error: error instanceof ApiError && error.status === 503 ? 'invitation_email_failed' : errorCode(error) };
  }
}
export async function cancelInvitation(org: string, id: string): Promise<MemberResult> {
  try {
    await api(`/organizations/${org}/invitations/${id}`, { method: 'DELETE' });
    revalidatePath('/', 'layout'); return { ok: true };
  } catch (error) { return { error: errorCode(error) }; }
}
export async function acceptInvitation(): Promise<MemberResult> {
  try {
    const context = await getInvitationContext();
    if (!context) { await clearInvitationContext(); return { error: 'invitation_unavailable' }; }
    await inspectInvitation(context.token);
    const result = await api<{ org_id: string }>('/invitations/accept', { method: 'POST', body: { token: context.token } });
    await clearInvitationContext();
    revalidatePath('/', 'layout'); return { ok: true, orgId: result.org_id };
  } catch (error) {
    if (error instanceof InvitationUnavailable) { await clearInvitationContext(); return { error: 'invitation_unavailable' }; }
    return { error: errorCode(error) };
  }
}
