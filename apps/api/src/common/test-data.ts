import type { Prisma } from '@prisma/client';

/**
 * Automated test accounts create organizations in the same database, and the database marks those organizations.
 * Everyone else only ever gets genuine records from a listing. Only the test accounts see fixtures, so their own tests still work.
 */
export function isFixtureAccount(email?: string) {
  return /^midan\.test\..+@example\.com$/.test(email ?? '');
}

/** What belongs in a normal listing of jobs. Demo jobs have their own clearly labeled listing. */
export function listableJobs(email?: string): Prisma.jobsWhereInput {
  return { status: 'published', is_demo: false, organizations: { is_demo: false, ...(isFixtureAccount(email) ? {} : { is_test: false }) } };
}

/**
 * One job by its ID, for the public job page and applying: the same rule as listings, so a test organization's job is
 * "not found" to everyone but the test accounts, even with a direct link. Genuine and demo organizations are unaffected.
 */
export function viewableJob(id: string, email?: string): Prisma.jobsWhereInput {
  return { id, ...(isFixtureAccount(email) ? {} : { organizations: { is_test: false } }) };
}
