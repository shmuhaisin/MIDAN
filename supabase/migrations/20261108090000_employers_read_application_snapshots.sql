-- P0 privacy: an organization reads what a candidate gave it when applying, not their live profile.
--
-- Before this, the policies "org reads applicants" on candidate_profiles and candidate_skills, and "org reads applicant skills"
-- on candidate_reference_skills, let any member of the organization read the candidate's live rows while any application was
-- active: later edits, notification settings, time zone, onboarding state and consent choices included. applications.profile_snapshot
-- already held the privacy-filtered copy, but only the candidate's own screens used it.
--
-- Now the snapshot also carries the skills listed at application time, leaves out the consent fields, and the three policies
-- are gone. The API reads names and profiles from the snapshot (applications.controller.ts, organizations.controller.ts,
-- evaluations.controller.ts). public.users keeps its policy: identity only (email, display name, locale).
--
-- Applications made before this keep their snapshot without the skill lists; nothing is copied from the live tables for them.

-- Same function as in 20261107110000_application_decision_rules.sql, apart from what the snapshot holds.
create or replace function private.guard_application() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  if tg_op = 'INSERT' then
    select org_id, status into j from public.jobs where id = new.job_id;
    if not found or j.status <> 'published' then
      raise exception 'This job is not open for applications' using errcode = '23514';
    end if;
    new.org_id := j.org_id;
    new.status := 'submitted';
    if new.cv_snapshot_path is not null and new.cv_snapshot_path not like new.candidate_id::text || '/applications/%' then
      raise exception 'This file does not belong to the application' using errcode = '23514';
    end if;
    -- What the organization reads about this candidate, as it stood when they applied. Their settings and consent choices
    -- stay theirs; the skills they listed are copied, so the organization never needs the live tables.
    select to_jsonb(p) - 'user_id' - 'cv_path' - 'onboarding_step' - 'onboarding_completed_at' - 'notification_prefs' - 'time_zone'
        - 'created_at' - 'updated_at' - 'share_profile_consent' - 'consent_updated_at'
      || jsonb_build_object(
        'email', (select u.email from public.users u where u.id = new.candidate_id),
        'skills', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en) order by s.name_en)
          from public.candidate_skills c join public.skills s on s.id = c.skill_id where c.candidate_id = new.candidate_id), '[]'),
        'reference_skills', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'sector_code', r.sector_code, 'skill_kind', r.skill_kind) order by r.name_ar)
          from public.candidate_reference_skills c join public.reference_skills r on r.id = c.reference_skill_id where c.candidate_id = new.candidate_id), '[]'),
        'captured_at', now())
      into new.profile_snapshot from public.candidate_profiles p where p.user_id = new.candidate_id;
    return new;
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'A withdrawn application cannot be changed' using errcode = '23514';
  end if;
  if new.status = 'withdrawn' and old.status <> 'withdrawn' and auth.uid() is distinct from old.candidate_id then
    raise exception 'Only the candidate can withdraw an application' using errcode = '42501';
  end if;
  new.profile_snapshot := case when new.status = 'withdrawn' then null else old.profile_snapshot end;
  -- Only public.share_cv_with_application attaches a copy later on. Nothing else can reach this table to set the flag.
  new.cv_snapshot_path := case
    when new.status = 'withdrawn' then null
    when old.cv_snapshot_path is null and current_setting('midan.sharing_cv', true) = 'on' then new.cv_snapshot_path
    else old.cv_snapshot_path
  end;
  return new;
end $$;

drop policy "org reads applicants" on public.candidate_profiles;
drop policy "org reads applicants" on public.candidate_skills;
drop policy "org reads applicant skills" on public.candidate_reference_skills;
