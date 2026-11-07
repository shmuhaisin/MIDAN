import { Prisma } from '@prisma/client';

/**
 * What an organization may read about an applicant: the snapshot taken when they applied (20261108090000), never the live
 * profile. Settings and consent choices stay the candidate's, including in snapshots taken before that migration.
 */
const HIDDEN = new Set([
  'user_id', 'cv_path', 'onboarding_step', 'onboarding_completed_at', 'notification_prefs', 'time_zone',
  'created_at', 'updated_at', 'share_profile_consent', 'consent_updated_at',
]);

type Item = Record<string, unknown>;
export type ApplicantProfile = Item & {
  full_name?: string;
  headline?: string | null;
  email?: string;
  skills?: { id: string; name_ar: string; name_en: string }[];
  reference_skills?: { id: string; name_ar: string; sector_code: string; skill_kind: string }[];
  captured_at?: string;
};

export function applicantProfile(snapshot: Prisma.JsonValue | null | undefined): ApplicantProfile | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => !HIDDEN.has(key))) as ApplicantProfile;
}

/** For lists: the raw snapshot is replaced by the name and headline the screens show. */
export function withApplicantName<T extends { profile_snapshot?: Prisma.JsonValue | null; users?: object }>(application: T) {
  const { profile_snapshot, ...rest } = application;
  const profile = applicantProfile(profile_snapshot);
  return {
    ...rest,
    users: { ...(rest.users ?? {}), candidate_profiles: profile ? { full_name: profile.full_name ?? '', headline: profile.headline ?? null } : null },
  };
}
