# Rolling back 20261112090000_employer_access_requests

`supabase/rollback/20261112090000_employer_access_requests.down.sql` puts back the earlier rule: **one workspace per
registry employer**. The migration allows one real and one test workspace per employer. So the rollback starts with a
preflight. If any registry employer has more than one linked workspace, it stops before changing anything and names
those employers:

```
Rollback of 20261112090000 stopped: these registry employers have more than one linked workspace (a real and a test one): <ids>
```

It never deletes a workspace by itself.

## Manual recovery (owner decision)

1. Find the pairs:

   ```sql
   select employer_registry_id, id, slug, is_test, created_at
   from public.organizations
   where employer_registry_id in (
     select employer_registry_id from public.organizations
     where employer_registry_id is not null group by 1 having count(*) > 1)
   order by employer_registry_id, is_test;
   ```

2. Decide, per employer, which workspace stays linked. Normally that's the real one (`is_test = false`).
3. Unlink the other one rather than deleting it. Its members, jobs and audit history are kept:

   ```sql
   update public.organizations set employer_registry_id = null where id = '<test workspace id>';
   ```

   If the test workspace really is disposable, deleting it is a separate, explicit decision.
4. Run the rollback again.

## What the rollback keeps and removes

| Item | After rollback |
|---|---|
| Memberships granted by approvals | **Kept** (they are ordinary memberships) |
| Registry identities | **Kept**, never changed |
| Audit records (requests, decisions, `provision_failed`) | **Kept** |
| Access requests | **Removed** (the table is dropped) |
| Functions added by the migration | **Removed** |
| Earlier function, policy and grant definitions | **Restored** |

`node scripts/verify-employer-access-migration.mjs` checks this on the **local** database only, in one transaction that
it rolls back: two migrate/rollback cycles, comparing functions, ACLs, policies, indexes, memberships and registry rows.
