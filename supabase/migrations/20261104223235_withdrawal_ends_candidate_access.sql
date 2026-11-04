-- Withdrawing an application ends the organization's access to the candidate's profile and documents.
create or replace function private.can_view_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id
    where a.candidate_id = p_candidate and a.status <> 'withdrawn' and m.user_id = auth.uid()
  )
$$;

create or replace function private.can_view_candidate_path(p_candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id
    where a.candidate_id::text = p_candidate and a.status <> 'withdrawn' and m.user_id = auth.uid()
  )
$$;
