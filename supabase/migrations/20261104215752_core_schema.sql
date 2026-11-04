-- Midan core schema. Tenant-owned rows carry org_id, and composite foreign keys
-- on (id, org_id) make it impossible to link rows across organizations.

create schema if not exists private;

create type public.org_role as enum ('owner', 'admin', 'recruiter', 'reviewer');
create type public.job_status as enum ('draft', 'published', 'closed');
create type public.application_status as enum (
  'submitted', 'under_review', 'assessment_invited', 'assessment_in_progress',
  'assessment_submitted', 'evaluated', 'shortlisted', 'rejected', 'hired', 'withdrawn'
);
create type public.version_status as enum ('draft', 'in_review', 'published', 'archived');
create type public.task_type as enum ('written_case_study', 'data_analysis', 'objective_questions', 'file_submission');
create type public.attempt_status as enum ('invited', 'in_progress', 'submitted', 'expired');
create type public.evaluation_status as enum ('pending', 'ai_proposed', 'needs_human_review', 'reviewed');
create type public.score_source as enum ('deterministic', 'ai_assisted', 'human_reviewed');
create type public.content_review_status as enum ('draft', 'reviewed', 'approved');

-- Identity. Rows in users are maintained by triggers on auth.users.
create table public.users (
  id uuid primary key,
  email text not null,
  display_name text,
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.candidate_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 200),
  headline text,
  city text,
  summary text,
  cv_path text,
  years_experience numeric(4, 1) check (years_experience >= 0),
  education jsonb not null default '[]',
  experience jsonb not null default '[]',
  share_profile_consent boolean not null default false,
  consent_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text not null,
  name_en text not null,
  description text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on public.organization_members (user_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.org_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references public.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.organization_invitations (org_id);
create index on public.organization_invitations (invited_by);

create table public.organization_branding (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  logo_path text,
  primary_color text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  welcome_ar text,
  welcome_en text,
  updated_at timestamptz not null default now()
);

-- Central taxonomy, shared by all tenants.
create table public.skill_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ar text not null,
  name_en text not null
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.skill_categories (id),
  slug text not null unique,
  name_ar text not null,
  name_en text not null,
  synonyms text[] not null default '{}',
  definition_ar text,
  definition_en text,
  source text not null,
  review_status public.content_review_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.skills (category_id);

create table public.skill_levels (
  skill_id uuid not null references public.skills (id) on delete cascade,
  level smallint not null check (level between 0 and 4),
  descriptor_ar text not null,
  descriptor_en text not null,
  primary key (skill_id, level)
);

create table public.candidate_skills (
  candidate_id uuid not null references public.users (id) on delete cascade,
  skill_id uuid not null references public.skills (id),
  created_at timestamptz not null default now(),
  primary key (candidate_id, skill_id)
);
create index on public.candidate_skills (skill_id);

-- Jobs and applications.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_ar text not null,
  title_en text not null,
  description_ar text,
  description_en text,
  location text,
  status public.job_status not null default 'draft',
  is_demo boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  unique (id, org_id)
);
create index on public.jobs (status);

create table public.job_skills (
  job_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  skill_id uuid not null references public.skills (id),
  required_level smallint not null default 2 check (required_level between 0 and 4),
  primary key (job_id, skill_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id) on delete cascade
);
create index on public.job_skills (skill_id);
create index on public.job_skills (job_id, org_id);
create index on public.job_skills (org_id);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.users (id),
  status public.application_status not null default 'submitted',
  cover_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id),
  unique (id, org_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id)
);
create index on public.applications (candidate_id);
create index on public.applications (org_id, status);
create index on public.applications (job_id, org_id);

create table public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  org_id uuid not null,
  from_status public.application_status,
  to_status public.application_status not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  foreign key (application_id, org_id) references public.applications (id, org_id) on delete cascade
);
create index on public.application_status_history (application_id, org_id);

-- Assessments. A published version and everything under it is immutable.
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null,
  title_ar text not null,
  title_en text not null,
  results_visible_to_candidate boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (job_id, org_id) references public.jobs (id, org_id)
);
create index on public.assessments (job_id, org_id);
create index on public.assessments (org_id);

create table public.assessment_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status public.version_status not null default 'draft',
  duration_minutes integer check (duration_minutes > 0),
  instructions_ar text,
  instructions_en text,
  published_by uuid references public.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, version_number),
  unique (id, org_id),
  foreign key (assessment_id, org_id) references public.assessments (id, org_id) on delete cascade
);
create index on public.assessment_versions (assessment_id, org_id);
create index on public.assessment_versions (org_id);
create index on public.assessment_versions (published_by);

create table public.assessment_tasks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  position integer not null check (position > 0),
  task_type public.task_type not null,
  title_ar text not null,
  title_en text not null,
  instructions_ar text not null,
  instructions_en text not null,
  weight numeric(6, 3) not null default 1 check (weight > 0),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, position),
  unique (id, org_id),
  foreign key (version_id, org_id) references public.assessment_versions (id, org_id) on delete cascade
);
create index on public.assessment_tasks (version_id, org_id);
create index on public.assessment_tasks (org_id);

-- Confidential: readable by the organization only. Objective answer keys live here, not on the task.
create table public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  description_ar text not null,
  description_en text not null,
  max_score numeric(6, 2) not null check (max_score > 0),
  weight numeric(6, 3) not null default 1 check (weight > 0),
  answer_key jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, code),
  unique (id, org_id),
  foreign key (task_id, org_id) references public.assessment_tasks (id, org_id) on delete cascade
);
create index on public.rubric_criteria (task_id, org_id);
create index on public.rubric_criteria (org_id);

create table public.task_skill_mappings (
  task_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  skill_id uuid not null references public.skills (id),
  weight numeric(6, 3) not null default 1 check (weight > 0),
  primary key (task_id, skill_id),
  foreign key (task_id, org_id) references public.assessment_tasks (id, org_id) on delete cascade
);
create index on public.task_skill_mappings (skill_id);
create index on public.task_skill_mappings (task_id, org_id);
create index on public.task_skill_mappings (org_id);

-- Execution.
create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  version_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.users (id),
  status public.attempt_status not null default 'invited',
  invited_by uuid references public.users (id) on delete set null,
  started_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, version_id),
  unique (id, org_id),
  foreign key (application_id, org_id) references public.applications (id, org_id),
  foreign key (version_id, org_id) references public.assessment_versions (id, org_id)
);
create index on public.assessment_attempts (candidate_id);
create index on public.assessment_attempts (application_id, org_id);
create index on public.assessment_attempts (version_id, org_id);
create index on public.assessment_attempts (org_id);
create index on public.assessment_attempts (invited_by);

create table public.task_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  task_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.users (id),
  answer jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, task_id),
  foreign key (attempt_id, org_id) references public.assessment_attempts (id, org_id) on delete cascade,
  foreign key (task_id, org_id) references public.assessment_tasks (id, org_id)
);
create index on public.task_responses (candidate_id);
create index on public.task_responses (attempt_id, org_id);
create index on public.task_responses (task_id, org_id);
create index on public.task_responses (org_id);

create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  task_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.users (id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  foreign key (attempt_id, org_id) references public.assessment_attempts (id, org_id) on delete cascade,
  foreign key (task_id, org_id) references public.assessment_tasks (id, org_id)
);
create index on public.evidence_files (candidate_id);
create index on public.evidence_files (attempt_id, org_id);
create index on public.evidence_files (task_id, org_id);
create index on public.evidence_files (org_id);

-- Evaluation. Results reach a candidate only after human review and an explicit release.
create table public.evaluation_results (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique,
  org_id uuid not null references public.organizations (id) on delete cascade,
  status public.evaluation_status not null default 'pending',
  overall_score numeric(6, 2),
  summary_ar text,
  summary_en text,
  released_to_candidate boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check (not released_to_candidate or status = 'reviewed'),
  foreign key (attempt_id, org_id) references public.assessment_attempts (id, org_id)
);
create index on public.evaluation_results (attempt_id, org_id);
create index on public.evaluation_results (org_id, status);

create table public.criterion_scores (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null,
  criterion_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  score numeric(6, 2) not null check (score >= 0),
  source public.score_source not null,
  evidence_ref text,
  explanation text,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  model_version text,
  prompt_version text,
  rubric_version integer,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (result_id, criterion_id, source),
  -- AI-assisted scores must carry full provenance.
  check (source <> 'ai_assisted' or (
    evidence_ref is not null and explanation is not null and confidence is not null
    and model_version is not null and prompt_version is not null and rubric_version is not null
  )),
  foreign key (result_id, org_id) references public.evaluation_results (id, org_id) on delete cascade,
  foreign key (criterion_id, org_id) references public.rubric_criteria (id, org_id)
);
create index on public.criterion_scores (result_id, org_id);
create index on public.criterion_scores (criterion_id, org_id);
create index on public.criterion_scores (org_id);
create index on public.criterion_scores (created_by);

create table public.skill_scores (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null,
  skill_id uuid not null references public.skills (id),
  org_id uuid not null references public.organizations (id) on delete cascade,
  level smallint not null check (level between 0 and 4),
  source public.score_source not null,
  explanation text,
  created_at timestamptz not null default now(),
  unique (result_id, skill_id),
  foreign key (result_id, org_id) references public.evaluation_results (id, org_id) on delete cascade
);
create index on public.skill_scores (skill_id);
create index on public.skill_scores (result_id, org_id);
create index on public.skill_scores (org_id);

-- Internal reviewer notes. Never visible to candidates.
create table public.evaluation_reviews (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  reviewer_id uuid not null references public.users (id),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (result_id, org_id) references public.evaluation_results (id, org_id) on delete cascade
);
create index on public.evaluation_reviews (result_id, org_id);
create index on public.evaluation_reviews (org_id);
create index on public.evaluation_reviews (reviewer_id);

-- org_id deliberately has no foreign key, so the trail outlives what it describes.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_logs (org_id, created_at desc);
