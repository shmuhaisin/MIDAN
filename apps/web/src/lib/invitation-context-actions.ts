'use server';
import { getAccessToken, setSessionCookies } from './session';
import { clearInvitationContext, getInvitationContext, inspectInvitation, InvitationUnavailable, saveInvitationContext } from './invitation-context';

export async function rememberInvitation(token: string): Promise<{ expiresAt?: number; error?: string }> {
  // Replace old context before validating a new link, including malformed input.
  await clearInvitationContext();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: 'invitation_unavailable' };
  try { return { expiresAt: await saveInvitationContext(token) }; }
  catch (error) { return { error: error instanceof InvitationUnavailable ? 'invitation_unavailable' : 'unavailable' }; }
}
export async function forgetInvitation(expectedExpiresAt?: number) {
  const current = await getInvitationContext();
  // A stale tab's expiry timer must not clear a newer invitation in another tab.
  if (expectedExpiresAt !== undefined && current && current.expiresAt !== expectedExpiresAt) return;
  await clearInvitationContext();
}

export async function finishInvitationConfirmation(access?: string, refresh?: string): Promise<{ ok?: boolean; error?: string; login?: boolean }> {
  const context = await getInvitationContext();
  if (!context) { await clearInvitationContext(); return { error: 'invitation_unavailable' }; }
  try {
    await inspectInvitation(context.token);
    const token = access || await getAccessToken();
    if (!token) return { login: true };
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY || '', authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!response.ok) return { error: 'session' };
    const user = await response.json() as { email?: string; email_confirmed_at?: string };
    if (!user.email || !user.email_confirmed_at) return { error: 'email_not_confirmed' };
    await inspectInvitation(context.token, user.email);
    if (access) {
      if (!refresh) return { login: true };
      await setSessionCookies(access, refresh);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof InvitationUnavailable) await clearInvitationContext();
    return { error: error instanceof InvitationUnavailable ? 'invitation_unavailable' : 'unavailable' };
  }
}
