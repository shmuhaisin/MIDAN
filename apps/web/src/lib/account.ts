import 'server-only';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from './api';
import { getSession } from './session';

type Account = { candidate_profiles: unknown | null; organization_members: { org_id: string }[] };

/** The signed-in account as the database records it, once per request. */
export const myAccount = cache(() => apiForPage<Account>('/me'));

/**
 * Candidate pages are for candidate accounts. An organization account is one with an organization membership and no
 * candidate profile (the database keeps the two apart); it goes to its workspace. The account type in the session token
 * is chosen by the person and can be edited, so it isn't trusted here. Signed-out visitors are left to the page, which
 * sends them to sign-in.
 */
export async function candidateOnly(locale: string) {
  if (!(await getSession())) return;
  const me = await myAccount();
  const org = me && !me.candidate_profiles ? me.organization_members[0] : undefined;
  if (org) redirect({ href: `/organization/${org.org_id}`, locale });
}
