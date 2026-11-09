// Organizations must be approved by a platform administrator before they publish, invite or receive applications
// (supabase/migrations/20261111090000_organization_verification.sql). Suites that need a working organization take it
// through the real review: the owner completes the profile, adds a commercial registration document and submits, and the
// fixture platform administrator approves. Fictional values only; local stack only.
import request from 'supertest';

const BASE = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const KEY = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
/** The smallest file the API accepts as a PDF: it checks the first bytes, not the name. */
export const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let adminToken: Promise<string> | null = null;
export function platformAdminToken() {
  adminToken ??= (async () => {
    const res = await fetch(`${BASE()}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: KEY(), 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.TEST_PLATFORM_ADMIN_EMAIL, password: process.env.TEST_PLATFORM_ADMIN_PASSWORD }),
    });
    if (!res.ok) throw new Error('Sign-in failed for PLATFORM_ADMIN');
    return ((await res.json()) as { access_token: string }).access_token;
  })();
  return adminToken;
}

/** A unique, fictional 10-digit commercial registration (starts with 9: not a real Saudi CR range used here). */
export function fictionalCr() {
  return `9${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

/** The profile fields review requires, all fictional. */
export const FICTIONAL_PROFILE = {
  business_email: 'hiring@example.test',
  contact_phone: '+966 11 000 0000',
  city: 'Riyadh',
  representative_name: 'Test Representative',
  representative_title: 'HR Lead',
};

/** Completes, submits and approves an organization, as its owner (token) and the fixture platform administrator. */
export async function approveOrganization(server: Parameters<typeof request>[0], ownerToken: string, orgId: string) {
  const owner = { Authorization: `Bearer ${ownerToken}` };
  const state = (await request(server).get(`/organizations/${orgId}/verification`).set(owner).expect(200)).body;
  if (state.organization.verification_status === 'approved') return;
  await request(server).patch(`/organizations/${orgId}/profile`).set(owner)
    .send({ ...FICTIONAL_PROFILE, commercial_registration: fictionalCr(), ...(state.organization.company_type ? {} : { company_type: 'private_company' }) })
    .expect(200);
  await request(server).post(`/organizations/${orgId}/verification/documents`).set(owner)
    .field('kind', 'commercial_registration').attach('file', TINY_PDF, { filename: 'cr.pdf', contentType: 'application/pdf' }).expect(201);
  await request(server).post(`/organizations/${orgId}/verification/submit`).set(owner).expect(201);
  await request(server).post(`/admin/organizations/${orgId}/decision`).set({ Authorization: `Bearer ${await platformAdminToken()}` })
    .send({ decision: 'approve' }).expect(201);
}
