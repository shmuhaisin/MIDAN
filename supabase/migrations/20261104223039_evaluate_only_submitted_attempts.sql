-- An evaluation can only exist for work the candidate has actually submitted.
create function private.guard_evaluation_result() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.assessment_attempts t where t.id = new.attempt_id and t.status = 'submitted') then
    raise exception 'Only a submitted attempt can be evaluated' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger guard_evaluation_result before insert on public.evaluation_results
  for each row execute function private.guard_evaluation_result();
