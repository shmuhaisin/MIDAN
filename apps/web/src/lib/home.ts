import 'server-only';

/** Where an account belongs after signing in: candidates to their dashboard, organizations to their workspace. */
export async function homeFor(accountType: string | undefined, token: string) {
  if (accountType !== 'organization') {
    try {
      const response = await fetch(`${process.env.API_URL}/v1/me`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
      const me = response.ok ? ((await response.json()) as { candidate_profiles: { onboarding_step: number; onboarding_completed_at: string | null; cv_path: string | null } | null }) : null;
      const profile = me?.candidate_profiles;
      // A new account starts in onboarding. Anyone already underway goes to their dashboard.
      if (profile && !profile.onboarding_completed_at && profile.onboarding_step === 0 && !profile.cv_path) return '/onboarding';
    } catch {
      // The API being down shouldn't stop a sign-in.
    }
    return '/dashboard';
  }
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
