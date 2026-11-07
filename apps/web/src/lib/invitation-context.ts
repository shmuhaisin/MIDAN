import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE_OPTIONS } from './session';

export const INVITATION_COOKIE = 'midan_invitation';
export type InvitationContext = { token: string; expiresAt: number };
export class InvitationUnavailable extends Error {}

export async function getInvitationContext(): Promise<InvitationContext | null> {
  try {
    const raw = (await cookies()).get(INVITATION_COOKIE)?.value;
    if (!raw) return null;
    const context = JSON.parse(raw) as InvitationContext;
    return /^[A-Za-z0-9_-]{43}$/.test(context.token) && Number.isFinite(context.expiresAt) && context.expiresAt > Date.now() ? context : null;
  } catch { return null; }
}
export async function clearInvitationContext() { (await cookies()).delete(INVITATION_COOKIE); }

export async function inspectInvitation(token: string, email?: string): Promise<number> {
  const response = await fetch(`${process.env.API_URL}/v1/invitations/context`, {
    method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, ...(email ? { email } : {}) }),
  });
  if ([400, 403, 404].includes(response.status)) throw new InvitationUnavailable();
  if (!response.ok) throw new Error('Invitation inspection unavailable');
  const data = await response.json() as { expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new InvitationUnavailable();
  return expiresAt;
}
export async function saveInvitationContext(token: string): Promise<number> {
  const expiresAt = await inspectInvitation(token);
  (await cookies()).set(INVITATION_COOKIE, JSON.stringify({ token, expiresAt }), {
    ...COOKIE_OPTIONS, expires: new Date(expiresAt),
  });
  return expiresAt;
}
