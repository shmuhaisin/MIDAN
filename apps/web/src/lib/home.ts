import 'server-only';

/** Where an account belongs after signing in: candidates to their dashboard, organizations to their workspace. */
export async function homeFor(accountType: string | undefined, token: string) {
  if (accountType !== 'organization') return '/dashboard';
  try {
    const response = await fetch(`${process.env.API_URL}/v1/me`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
    if (response.ok) {
      const me = (await response.json()) as { organization_members: { org_id: string }[] };
      if (me.organization_members[0]) return `/organization/${me.organization_members[0].org_id}`;
    }
  } catch {
    // The API being down shouldn't stop a sign-in. The next page explains it.
  }
  return '/organization/new';
}
