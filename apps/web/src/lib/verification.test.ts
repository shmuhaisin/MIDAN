import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityLocked, isEditable, missingForReview } from './verification.ts';
import type { VerificationState } from './verification.ts';

const complete = {
  name_ar: 'جهة', name_en: 'Org', company_type: 'startup', commercial_registration: '9000000001', business_email: 'a@example.test',
  contact_phone: '+966 11 000 0000', city: 'Riyadh', representative_name: 'Rep', representative_title: 'HR',
} as unknown as VerificationState['organization'];
const cr = { id: '1', kind: 'commercial_registration', file_name: 'cr.pdf', mime_type: 'application/pdf', size_bytes: 10, created_at: '' };

test('lists every missing field and the commercial registration document', () => {
  assert.deepEqual(missingForReview({ organization: { ...complete, city: '  ', company_type: null }, documents: [] }),
    ['company_type', 'city', 'document_commercial_registration']);
});

test('needs a commercial registration document specifically', () => {
  assert.deepEqual(missingForReview({ organization: complete, documents: [{ ...cr, kind: 'other' }] }), ['document_commercial_registration']);
  assert.deepEqual(missingForReview({ organization: complete, documents: [cr] }), []);
});

test('locks what is being checked and allows edits only before review', () => {
  assert.ok(['draft', 'changes_requested', 'rejected'].every((s) => isEditable(s as never)));
  assert.ok(!['pending_review', 'approved', 'suspended'].some((s) => isEditable(s as never)));
  assert.equal(identityLocked('approved'), true);
  assert.equal(identityLocked('changes_requested'), false);
});
