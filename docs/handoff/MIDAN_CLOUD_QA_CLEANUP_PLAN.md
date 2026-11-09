# Cloud QA records — cleanup plan (not executed; needs the owner's approval)

Project **al-midan-ya-hamidan** (`squpszwbrqkflezfltoj`). Inventory taken read-only on 2026-11-10 after the Employer and
Admin QA. Every record below was created by the QA run `mw9rz7iu`; nothing else is touched.

| Record | Count | Identified by |
| --- | --- | --- |
| Auth accounts | 4 | `midan.test.cloud-qa-mw9rz7iu-{employer,outsider,admin,candidate}@example.com` |
| Organizations | 2 | slugs `midan-test-cloud-qa-mw9rz7iu-b7af3bef` (approved), `midan-test-cloud-qa-mw9rz7iu-outsider-b2d5e209` (draft) |
| Jobs (draft) / requirements | 2 / 1 | `org_id` of the QA organizations |
| Applications / status history | 1 / 2 | QA candidate's application (shortlisted) |
| Organization documents / storage files | 2 / 2 | bucket `organization-documents`, folder = QA organization id |
| Review requests | 2 | `organization_verification_requests.org_id` |
| Audit rows | 22 | `audit_logs.org_id` (the trail has no foreign key, by design) |
| Notifications to QA accounts | 8 | `notifications.user_id` |
| Notifications to the owner's admin account | 3 | "organization submitted for review" links to `/admin/organizations/94fcbcb3-…` |
| QA admin grant | 0 | already removed |

Not part of this plan: `midan-test-cloud-mw9rcmqa` (a test organization from the integration branch's cloud run; its
owner decides).

## Order

1. **Storage files first** (deleting only the rows would leave the files): Dashboard > Storage > `organization-documents`,
   delete the folders `94fcbcb3-e3e4-43f0-aa58-c98de8c642d3` and `f4e1bbd9-7f2c-451d-9bef-1f93cd0fad53`.
2. **Database rows**, in one transaction, after checking the counts match the table above (SQL editor, role postgres):

```sql
begin;
-- Check first: these must match the inventory before anything is deleted.
select count(*) from public.users where email like 'midan.test.cloud-qa-mw9rz7iu-%';            -- 4
select count(*) from public.organizations where slug like 'midan-test-cloud-qa-mw9rz7iu%';        -- 2

delete from public.notifications
 where link like '/admin/organizations/94fcbcb3-e3e4-43f0-aa58-c98de8c642d3%';                     -- 3, the owner's
delete from public.audit_logs
 where org_id in (select id from public.organizations where slug like 'midan-test-cloud-qa-mw9rz7iu%');
-- Organizations cascade to their jobs, requirements, applications, documents, review requests and memberships.
delete from public.organizations where slug like 'midan-test-cloud-qa-mw9rz7iu%';
-- Accounts cascade to public.users, candidate profiles and their notifications.
delete from auth.users where email like 'midan.test.cloud-qa-mw9rz7iu-%';
-- Expect zero for each, then commit; otherwise rollback.
select (select count(*) from public.users where email like 'midan.test.cloud-qa-mw9rz7iu-%') as users_left,
       (select count(*) from public.organizations where slug like 'midan-test-cloud-qa-mw9rz7iu%') as orgs_left;
commit;
```

3. Remove the `TEST_CLOUD_QA_*` lines from `.env`.

Some database rules (for example hiring decisions being final) guard updates, not deletes, but a delete can still be
refused by a trigger; if any statement fails, run `rollback` and nothing is removed. The statements haven't been run
against the cloud: rehearse them on a copy first if in doubt.
