-- Rules enforced in the database, so they hold however a row is written.
-- Everything in the private schema is unreachable through the Data API.

create function private.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
    join information_schema.tables tb using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- Keep public.users in step with Supabase Auth.
create function private.sync_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.users (id, email, display_name)
    values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  elsif tg_op = 'UPDATE' then
    update public.users set email = new.email where id = new.id;
  else
    delete from public.users where id = old.id;
    return old;
  end if;
  return new;
end $$;

create trigger sync_public_user_insert after insert on auth.users for each row execute function private.sync_auth_user();
create trigger sync_public_user_update after update of email on auth.users for each row execute function private.sync_auth_user();
create trigger sync_public_user_delete after delete on auth.users for each row execute function private.sync_auth_user();

-- Helpers used by RLS policies. Security definer, so policies don't recurse.
create function private.is_org_member(p_org uuid, p_roles public.org_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and (p_roles is null or m.role = any (p_roles))
  )
$$;

-- An organization may see a candidate only once that candidate has applied to it.
create function private.can_view_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    join public.organization_members m on m.org_id = a.org_id
    where a.candidate_id = p_candidate and m.user_id = auth.uid()
  )
$$;

create function private.candidate_has_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessment_attempts t
    where t.version_id = p_version and t.candidate_id = auth.uid()
  )
$$;

create function private.candidate_has_assessment(p_assessment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessment_attempts t
    join public.assessment_versions v on v.id = t.version_id
    where v.assessment_id = p_assessment and t.candidate_id = auth.uid()
  )
$$;

create function private.attempt_submitted(p_attempt uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assessment_attempts t where t.id = p_attempt and t.status = 'submitted')
$$;

create function private.result_released_to_me(p_result uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.evaluation_results r
    join public.assessment_attempts t on t.id = r.attempt_id
    where r.id = p_result and r.released_to_candidate and t.candidate_id = auth.uid()
  )
$$;

-- Applications.
create function private.guard_application() returns trigger language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  if tg_op = 'INSERT' then
    select org_id, status into j from public.jobs where id = new.job_id;
    if not found or j.status <> 'published' then
      raise exception 'This job is not open for applications' using errcode = '23514';
    end if;
    new.org_id := j.org_id;
    new.status := 'submitted';
    return new;
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if new.status = 'withdrawn' and old.status <> 'withdrawn' and auth.uid() is distinct from old.candidate_id then
    raise exception 'Only the candidate can withdraw an application' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_application before insert or update on public.applications
  for each row execute function private.guard_application();

create function private.log_application_status() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.application_status_history (application_id, org_id, from_status, to_status, changed_by)
    values (new.id, new.org_id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return null;
end $$;

create trigger log_application_status after insert or update of status on public.applications
  for each row execute function private.log_application_status();

-- Organization membership: an organization always keeps an owner.
create function private.guard_last_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
    and exists (select 1 from public.organizations o where o.id = old.org_id)
    and not exists (
      select 1 from public.organization_members m
      where m.org_id = old.org_id and m.role = 'owner' and m.id <> old.id
    )
  then
    raise exception 'An organization must keep at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

create trigger guard_last_owner before update or delete on public.organization_members
  for each row execute function private.guard_last_owner();

-- Assessment versions: publishing needs an authorized person, and published content never changes.
create function private.guard_version() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_by := null;
    new.published_at := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'in_review') and exists (select 1 from public.organizations o where o.id = old.org_id) then
      raise exception 'A published version cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;

  if old.status in ('published', 'archived') then
    if new.status = 'archived' and old.status = 'published'
      and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
      return new;
    end if;
    raise exception 'A published version is immutable' using errcode = '23514';
  end if;

  if new.status = 'archived' then
    raise exception 'Only a published version can be archived' using errcode = '23514';
  end if;

  if new.status = 'published' then
    if not private.is_org_member(old.org_id, array['owner', 'admin']::public.org_role[]) then
      raise exception 'Publishing requires approval by an organization owner or admin' using errcode = '42501';
    end if;
    if not exists (select 1 from public.assessment_tasks t where t.version_id = old.id)
      or exists (
        select 1 from public.assessment_tasks t
        where t.version_id = old.id
          and not exists (select 1 from public.rubric_criteria c where c.task_id = t.id)
      ) then
      raise exception 'Every version needs tasks, and every task needs rubric criteria' using errcode = '23514';
    end if;
    new.published_by := auth.uid();
    new.published_at := now();
  end if;
  return new;
end $$;

create trigger guard_version before insert or update or delete on public.assessment_versions
  for each row execute function private.guard_version();

create function private.guard_version_content() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_task uuid;
  v_version uuid;
  v_status public.version_status;
  r jsonb;
begin
  foreach r in array array[case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end]
  loop
    continue when r is null;
    if tg_table_name = 'assessment_tasks' then
      v_version := (r ->> 'version_id')::uuid;
    else
      v_task := (r ->> 'task_id')::uuid;
      select version_id into v_version from public.assessment_tasks where id = v_task;
    end if;
    select status into v_status from public.assessment_versions where id = v_version;
    -- Not found means the parent is being removed by a cascade.
    if v_status in ('published', 'archived') then
      raise exception 'A published version is immutable' using errcode = '23514';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create trigger guard_content before insert or update or delete on public.assessment_tasks
  for each row execute function private.guard_version_content();
create trigger guard_content before insert or update or delete on public.rubric_criteria
  for each row execute function private.guard_version_content();
create trigger guard_content before insert or update or delete on public.task_skill_mappings
  for each row execute function private.guard_version_content();

-- Attempts always point at a published version of an assessment for the application's own job.
create function private.guard_attempt() returns trigger language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select job_id, org_id, candidate_id, status into a from public.applications where id = new.application_id;
  if not found or a.status = 'withdrawn' then
    raise exception 'Application is not available' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.assessment_versions v
    join public.assessments s on s.id = v.assessment_id
    where v.id = new.version_id and v.status = 'published' and s.job_id = a.job_id
  ) then
    raise exception 'Candidates can only be invited to a published version for this job' using errcode = '23514';
  end if;
  new.org_id := a.org_id;
  new.candidate_id := a.candidate_id;
  new.status := 'invited';
  new.invited_by := auth.uid();
  return new;
end $$;

create trigger guard_attempt before insert on public.assessment_attempts
  for each row execute function private.guard_attempt();

create function private.mark_application_invited() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.applications set status = 'assessment_invited' where id = new.application_id;
  return null;
end $$;

create trigger mark_application_invited after insert on public.assessment_attempts
  for each row execute function private.mark_application_invited();

-- Responses and evidence: only while the attempt is open, and only for its own tasks.
create function private.guard_attempt_content() returns trigger language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select status, version_id, org_id, candidate_id into t from public.assessment_attempts where id = new.attempt_id;
  if not found or t.status <> 'in_progress' then
    raise exception 'This attempt is not open for changes' using errcode = '23514';
  end if;
  if not exists (select 1 from public.assessment_tasks x where x.id = new.task_id and x.version_id = t.version_id) then
    raise exception 'This task is not part of the attempt' using errcode = '23514';
  end if;
  new.org_id := t.org_id;
  new.candidate_id := t.candidate_id;
  return new;
end $$;

create trigger guard_attempt_content before insert or update on public.task_responses
  for each row execute function private.guard_attempt_content();
create trigger guard_attempt_content before insert on public.evidence_files
  for each row execute function private.guard_attempt_content();

create function private.stamp_release() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.released_to_candidate and not old.released_to_candidate then
    new.released_at := now();
  end if;
  return new;
end $$;

create trigger stamp_release before update on public.evaluation_results
  for each row execute function private.stamp_release();

-- Audit trail. Records who did what, not the content.
create function private.write_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id, details)
  values (
    coalesce((r ->> 'org_id')::uuid, (r ->> 'id')::uuid), auth.uid(), lower(tg_op), tg_table_name, r ->> 'id',
    jsonb_strip_nulls(jsonb_build_object(
      'status', r ->> 'status',
      'role', r ->> 'role',
      'released_to_candidate', r -> 'released_to_candidate'
    ))
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'organization_members', 'applications', 'assessment_versions', 'evaluation_results'] loop
    execute format('create trigger write_audit after insert or update or delete on public.%I for each row execute function private.write_audit()', t);
  end loop;
end $$;

-- Operations a person performs through a controlled path instead of a direct write.
create function public.create_organization(p_slug text, p_name_ar text, p_name_en text)
returns public.organizations language plpgsql security definer set search_path = '' as $$
declare o public.organizations;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create an organization' using errcode = '42501';
  end if;
  insert into public.organizations (slug, name_ar, name_en) values (p_slug, p_name_ar, p_name_en) returning * into o;
  insert into public.organization_members (org_id, user_id, role) values (o.id, auth.uid(), 'owner');
  insert into public.organization_branding (org_id) values (o.id);
  return o;
end $$;

create function public.start_attempt(p_attempt uuid)
returns public.assessment_attempts language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  update public.assessment_attempts set status = 'in_progress', started_at = now()
  where id = p_attempt and candidate_id = auth.uid() and status = 'invited' returning * into t;
  if not found then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  update public.applications set status = 'assessment_in_progress' where id = t.application_id;
  return t;
end $$;

create function public.submit_attempt(p_attempt uuid)
returns public.assessment_attempts language plpgsql security definer set search_path = '' as $$
declare t public.assessment_attempts;
begin
  update public.assessment_attempts set status = 'submitted', submitted_at = now()
  where id = p_attempt and candidate_id = auth.uid() and status = 'in_progress' returning * into t;
  if not found then
    raise exception 'Attempt not available' using errcode = '42501';
  end if;
  update public.applications set status = 'assessment_submitted' where id = t.application_id;
  return t;
end $$;

create function public.withdraw_application(p_application uuid)
returns public.applications language plpgsql security definer set search_path = '' as $$
declare a public.applications;
begin
  update public.applications set status = 'withdrawn'
  where id = p_application and candidate_id = auth.uid() returning * into a;
  if not found then
    raise exception 'Application not available' using errcode = '42501';
  end if;
  return a;
end $$;

revoke all on function public.create_organization(text, text, text), public.start_attempt(uuid),
  public.submit_attempt(uuid), public.withdraw_application(uuid) from public, anon;
grant execute on function public.create_organization(text, text, text), public.start_attempt(uuid),
  public.submit_attempt(uuid), public.withdraw_application(uuid) to authenticated;
