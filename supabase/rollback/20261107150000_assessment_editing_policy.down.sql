-- Rolls back 20261107150000_assessment_editing_policy. Run as postgres, in one transaction, only after any later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Lost: the generated, revision-base and approved snapshots, and the review records. Audit rows already written stay in
-- public.audit_logs. Draft versions created as revisions stay, as ordinary drafts.
drop function public.create_assessment_revision(uuid);
drop function public.assessment_review_state(uuid);
drop function public.assessment_version_changes(uuid);
drop function public.review_assessment_changes(uuid, bigint, text);
drop table public.assessment_change_reviews;
drop function public.assessment_validation(uuid);
drop function public.record_generated_draft(uuid);
drop table public.assessment_version_snapshots;

-- private.guard_version as 20261105231005_candidate_experience.sql defined it. It no longer calls the functions dropped below.
create or replace function private.guard_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_by := null;
    new.published_at := null;
    new.requirements_snapshot := null;
    new.candidate_rubric := null;
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

  new.requirements_snapshot := null;
  new.candidate_rubric := null;
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
    new.requirements_snapshot := private.build_requirements_snapshot(old.id);
    if new.rubric_shared then
      new.candidate_rubric := private.build_candidate_rubric(old.id);
    end if;
  end if;
  return new;
end $$;

drop function private.validate_assessment_version(uuid);
drop function private.assessment_version_content(uuid);
drop function private.latest_reviewable_change(uuid);
drop function private.is_reviewable_change(public.audit_logs);
drop index public.audit_logs_assessment_version;

drop trigger write_assessment_audit on public.assessment_versions;
drop trigger write_assessment_audit on public.task_requirement_mappings;
drop trigger write_assessment_audit on public.rubric_criteria;
drop trigger write_assessment_audit_delete on public.assessment_tasks;
drop trigger write_assessment_audit on public.assessment_tasks;
drop function private.write_assessment_audit();

-- The triggers of 20261107120000_audit_assessment_draft_edits.
create trigger write_audit after update or delete on public.assessment_tasks for each row execute function private.write_audit();
create trigger write_audit after update or delete on public.rubric_criteria for each row execute function private.write_audit();
