-- Reverses 20261110120000_assessment_task_order: the uniqueness of positions is checked row by row again, as before.
-- No data changes. The reorder endpoint then fails with a uniqueness error instead of reordering.
alter table public.assessment_tasks drop constraint if exists assessment_tasks_version_position_key;
alter table public.assessment_tasks add constraint assessment_tasks_version_id_position_key unique (version_id, position);
