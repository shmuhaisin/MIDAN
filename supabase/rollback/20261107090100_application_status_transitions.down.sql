-- Rolls back 20261107090100_application_status_transitions. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
set local check_function_bodies = off;

drop function if exists private.assessments_reviewed(uuid);
drop function if exists private.manual_status_change_allowed(public.application_status, public.application_status);
drop function if exists public.set_application_status(uuid, public.application_status);
create or replace function private.guard_outcome() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare a record;
begin
  select candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  new.candidate_id := a.candidate_id;
  new.issued_by := auth.uid();
  new.issued_at := now();
  return new;
end $$;
CREATE POLICY "org updates status" ON public.applications FOR UPDATE TO authenticated USING (private.is_org_member(org_id, ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'recruiter'::public.org_role])) WITH CHECK (private.is_org_member(org_id, ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'recruiter'::public.org_role]));
GRANT UPDATE(status) ON TABLE public.applications TO authenticated;
