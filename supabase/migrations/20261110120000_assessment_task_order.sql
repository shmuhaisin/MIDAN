-- Reordering the tasks of a draft assessment version. Additive in behaviour: the same uniqueness, checked later.
--
-- Positions are unique per version, and that uniqueness was checked row by row, so moving task 3 above task 1 could only
-- be done through temporary positions, which the editing history would record as changes nobody made. The constraint is
-- now DEFERRABLE INITIALLY IMMEDIATE: every statement still checks it at once, unless a transaction asks for the check to
-- wait until commit (SET CONSTRAINTS ... DEFERRED), which is what the reorder endpoint does. Each moved task is then
-- updated once, to its final position, and the history records exactly those moves.
--
-- Nothing else changes: task ids, rubric criteria, requirement links and evaluations keep their references, and the
-- existing guard still refuses any change to a published or archived version, so candidates' assigned versions and their
-- submissions are untouched.

do $$
declare
  existing text;
begin
  select c.conname into existing
  from pg_constraint c
  where c.conrelid = 'public.assessment_tasks'::regclass
    and c.contype = 'u'
    and (select array_agg(a.attname::text order by a.attname)
         from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) = array['position', 'version_id'];
  if existing is null then
    raise exception 'The unique (version_id, position) constraint on assessment_tasks was not found';
  end if;
  execute format('alter table public.assessment_tasks drop constraint %I', existing);
end $$;

alter table public.assessment_tasks
  add constraint assessment_tasks_version_position_key unique (version_id, position) deferrable initially immediate;

comment on constraint assessment_tasks_version_position_key on public.assessment_tasks is
  'One task per position in a version. Deferrable so a reorder can move tasks to their final positions in one transaction.';
