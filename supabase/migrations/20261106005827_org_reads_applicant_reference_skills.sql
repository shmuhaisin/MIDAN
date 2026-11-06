-- An organization sees the skills a candidate chose while that candidate has an active application there, like the rest of the profile.
create policy "org reads applicant skills" on public.candidate_reference_skills for select to authenticated
  using (private.can_view_candidate_path(candidate_id::text));
