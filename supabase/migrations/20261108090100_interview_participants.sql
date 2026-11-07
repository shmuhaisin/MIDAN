-- P0: an interview room is for the people taking part in that interview, not for every member of the organization.
--
-- Before this, POST /interviews/:id/join gave a video token to any member of the organization, any role, inside the join
-- window. Now the staff who may join are the interview's participants: whoever scheduled it, and the members they add.
-- The candidate's rule is unchanged (only once they have accepted, inside the window). The API asks
-- public.can_join_interview before it requests a token; membership is checked again there, so someone who leaves the
-- organization loses access at once. Participants are also the calendar event's attendees.

create table public.interview_participants (
  interview_id uuid not null references public.interviews (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  added_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  primary key (interview_id, user_id)
);
create index on public.interview_participants (org_id);
create index on public.interview_participants (user_id);
create index on public.interview_participants (added_by);

create function private.guard_interview_participant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.interviews where id = new.interview_id;
  if v_org is null then raise exception 'Interview not available' using errcode = '23514'; end if;
  if not exists (select 1 from public.organization_members m where m.org_id = v_org and m.user_id = new.user_id) then
    raise exception 'Only a member of the organization can take part in its interviews' using errcode = '23514';
  end if;
  new.org_id := v_org;
  new.added_by := coalesce(auth.uid(), new.added_by);
  new.created_at := now();
  return new;
end $$;
create trigger guard_interview_participant before insert on public.interview_participants
  for each row execute function private.guard_interview_participant();
create trigger write_audit after insert or delete on public.interview_participants for each row execute function private.write_audit();

-- Whoever schedules an interview takes part in it.
create function private.add_interview_scheduler() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    insert into public.interview_participants (interview_id, org_id, user_id, added_by)
    values (new.id, new.org_id, new.created_by, new.created_by) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger add_interview_scheduler after insert on public.interviews for each row execute function private.add_interview_scheduler();

insert into public.interview_participants (interview_id, org_id, user_id, added_by)
select i.id, i.org_id, i.created_by, i.created_by from public.interviews i
where i.created_by is not null and exists (select 1 from public.organization_members m where m.org_id = i.org_id and m.user_id = i.created_by)
on conflict do nothing;

alter table public.interview_participants enable row level security;
create policy "org members read" on public.interview_participants for select to authenticated using (private.is_org_member(org_id));
create policy "org builders write" on public.interview_participants for all to authenticated
  using (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (private.is_org_member(org_id, array['owner', 'admin', 'recruiter']::public.org_role[]));
grant select, insert, delete on public.interview_participants to authenticated;

/** Who may join an interview's room: its candidate, or a participant who is still a member of the organization. */
create function public.can_join_interview(p_interview uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.interviews i
    where i.id = p_interview and (
      i.candidate_id = auth.uid()
      or exists (
        select 1 from public.interview_participants p
        join public.organization_members m on m.org_id = p.org_id and m.user_id = p.user_id
        where p.interview_id = i.id and p.user_id = auth.uid()
      )
    )
  )
$$;
revoke all on function public.can_join_interview(uuid) from public, anon;
grant execute on function public.can_join_interview(uuid) to authenticated;
revoke all on function private.guard_interview_participant(), private.add_interview_scheduler() from public, anon, authenticated;
