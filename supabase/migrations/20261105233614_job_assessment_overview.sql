-- What anyone may know about a job's approved assessments before applying. Tasks, rubrics and scenarios stay private.
create function public.job_assessment_overview(p_job uuid) returns table (
  assessment_id uuid, title_ar text, title_en text, duration_minutes integer, is_timed boolean, deadline_hours integer, tasks integer
) language sql stable security definer set search_path = '' as $$
  select distinct on (s.id) s.id, s.title_ar, s.title_en, v.duration_minutes, v.is_timed, v.deadline_hours,
    (select count(*)::integer from public.assessment_tasks t where t.version_id = v.id)
  from public.assessments s
  join public.assessment_versions v on v.assessment_id = s.id and v.status = 'published'
  join public.jobs j on j.id = s.job_id and j.status = 'published'
  where s.job_id = p_job
  order by s.id, v.version_number desc
$$;
revoke all on function public.job_assessment_overview(uuid) from public;
grant execute on function public.job_assessment_overview(uuid) to anon, authenticated;
