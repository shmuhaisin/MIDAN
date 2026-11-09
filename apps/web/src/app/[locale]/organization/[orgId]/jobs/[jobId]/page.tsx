import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import clsx from 'clsx';
import { Arrow, Eyebrow } from '@/components/brand';
import { Icon } from '@/components/icons';
import { StageMeter } from '@/components/workspace-kit';
import { ApplicantStatus, JobStatusButtons } from '@/components/forms';
import { canReopenApplications } from '@/lib/application-status';
import { RequirementsEditor, type Requirement } from '@/components/requirements';
import { JobAnalysisPanel, type Analysis, type CustomSkill } from '@/components/job-analysis';
import { AssessmentSwitcher, AssessmentTitle, VersionSettings, EmptyAssessment, FieldSelect, GenerateButton, InviteButton, JobDetailsForm, PublishPanel, TaskList } from '@/components/workspace';

import { Link, redirect } from '@/i18n/navigation';
import { api, apiForPage } from '@/lib/api';
import { uncoveredItems, type ReviewState } from '@/lib/assessment-review';
import { ChangeReview, ReviseButton } from '@/components/change-review';
import { AssessorGuide, QualityPanel, type QualityReport } from '@/components/assessment-intel';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type AttemptOf = { id: string; version_number: number; assessment_id: string; assessments: { title_ar: string; title_en: string } };
type Attempt = { id: string; status: string; assessment_versions: AttemptOf; evaluation_results: { id: string; status: string; released_to_candidate: boolean } | null };
type Job = {
  job_reference_skills?: { is_required: boolean; required_level?: number | null; reference_skills: { id: string; name_ar: string; sector_code: string } }[];
  id: string; slug: string; status: string; title_ar: string; title_en: string; description_ar: string | null; description_en: string | null;
  requirements_ar: string | null; requirements_en: string | null; location: string | null;
  employment_type: string | null; salary_min: string | null; salary_max: string | null; application_deadline: string | null; sector: string | null; experience_level: string | null;
  organizations: { slug: string };
  job_skills: { skill_id: string; required_level: number }[];
  applications: { id: string; status: string; users: { email: string; candidate_profiles: { full_name: string; headline: string | null } | null }; assessment_attempts: Attempt[] }[];
};
type Skill = { id: string; name_ar: string; name_en: string };
type Latest = {
  run: { mode: string } | null;
  assessments: { id: string; title_ar: string; title_en: string; assessment_versions: { id: string; version_number: number; status: string }[] }[];
  version: null | {
    id: string; version_number: number; status: string; scenario_ar: string | null; scenario_en: string | null; deadline_hours: number | null; duration_minutes: number | null; is_timed: boolean; rubric_shared: boolean;
    assessments: { id: string; title_ar: string; title_en: string; professional_field: string | null };
    assessment_tasks: {
      id: string; position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string; weight: string;
      rubric_criteria: { id: string; code: string; description_ar: string; description_en: string; max_score: string; weight: string; answer_key: unknown }[];
      task_skill_mappings: { skills: Skill }[];
      task_requirement_mappings: { requirement_id: string }[];
      reference_skill_ids?: string[];
      config?: { questions?: { id: string; prompt_ar: string; prompt_en: string; options: { id: string; label_ar: string; label_en: string }[] }[]; dataset_name?: string; dataset_csv?: string };
    }[];
  };
};
type Compared = {
  id: string;
  assessment_versions: AttemptOf;
  applications: { users: { email: string; candidate_profiles: { full_name: string } | null } };
  evaluation_results: null | { status: string; overall_score: string | null; skill_scores: { skill_id: string; level: number; skills: { name_ar: string; name_en: string } }[] };
};

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string; jobId: string }>; searchParams: Promise<{ assessment?: string; step?: string }> }) {
  const { locale, orgId, jobId } = await params;
  const { assessment: chosen, step: stepParam } = await searchParams;
  // The job wizard: one section at a time after the job is named. Without ?step the full workspace shows.
  const WIZARD = ['details', 'requirements', 'reference-skills', 'assessment', 'review'] as const;
  const stepNo = Number(stepParam);
  const wizard = stepNo >= 1 && stepNo <= WIZARD.length ? WIZARD[stepNo - 1] : null;
  const show = (id: (typeof WIZARD)[number]) => !wizard || wizard === id;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId) || !/^[0-9a-f-]{36}$/.test(jobId)) notFound();
  const [org, job, skills, latest, compared, requirements, analysis, custom] = await Promise.all([
    apiForPage<{ my_role: string }>(`/organizations/${orgId}`),
    apiForPage<Job>(`/organizations/${orgId}/jobs/${jobId}`),
    api<Skill[]>('/skills'),
    apiForPage<Latest>(`/organizations/${orgId}/jobs/${jobId}/assessment${chosen && /^[0-9a-f-]{36}$/.test(chosen) ? `?assessment=${chosen}` : ''}`),
    apiForPage<Compared[]>(`/organizations/${orgId}/jobs/${jobId}/report`),
    apiForPage<Requirement[]>(`/organizations/${orgId}/jobs/${jobId}/requirements`),
    apiForPage<Analysis | null>(`/organizations/${orgId}/jobs/${jobId}/analyses/latest`),
    apiForPage<CustomSkill[]>(`/organizations/${orgId}/jobs/${jobId}/custom-skills`),
  ]);
  if (!org || !job || !latest) notFound();
  const t = await getTranslations({ locale, namespace: 'workspace' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const to = await getTranslations({ locale, namespace: 'org' });
  const tr = await getTranslations({ locale, namespace: 'requirements' });
  const tj = await getTranslations({ locale, namespace: 'jobAnalysis' });
  const tw = await getTranslations({ locale, namespace: 'jobWizard' });

  const canBuild = ['owner', 'admin', 'recruiter'].includes(org.my_role);
  const canPublish = ['owner', 'admin'].includes(org.my_role);
  const canEvaluate = ['owner', 'admin', 'reviewer'].includes(org.my_role);
  const version = latest.version;
  const editable = version?.status === 'draft' && canBuild;
  const published = version?.status === 'published';
  const coveredIds = new Set(version?.assessment_tasks.flatMap((x) => x.task_skill_mappings.map((m) => m.skills.id)));
  const required = skills.filter((s) => job.job_skills.some((j) => j.skill_id === s.id));
  const assessments = latest.assessments;
  // The review before approval: MIDAN's original, every change people made, MIDAN's checks.
  const review = version && canBuild ? await apiForPage<ReviewState>(`/organizations/${orgId}/assessment-versions/${version.id}/changes`) : null;
  // The assessor guide and MIDAN's quality report: staff only, never part of what a candidate receives.
  const intel = version && (canBuild || canEvaluate)
    ? await apiForPage<{ guide: Parameters<typeof AssessorGuide>[0]['guide']; quality: QualityReport }>(`/organizations/${orgId}/assessment-versions/${version.id}/guide`)
    : null;
  const reviewedThrough = Math.max(0, ...(review?.reviews ?? []).map((r) => r.reviewed_through));
  const unreviewedChanges = review ? review.changes.filter((c) => c.needs_review && c.id > reviewedThrough).length : 0;
  const liveAssessments = assessments.filter((a) => a.assessment_versions.some((v) => v.status === 'published'));
  const neverPublished = (a?: Latest['assessments'][number]) => Boolean(a) && a!.assessment_versions.every((v) => ['draft', 'in_review'].includes(v.status));

  const evaluated = (compared ?? []).filter((c) => c.evaluation_results?.status === 'reviewed');
  // Only attempts on the same version share criteria, so each version gets its own comparison.
  const compareGroups = [...new Map(evaluated.map((c) => [c.assessment_versions.id, c.assessment_versions])).values()].map((of) => {
    const rows = evaluated.filter((c) => c.assessment_versions.id === of.id);
    return { of, rows, skills: [...new Map(rows.flatMap((c) => c.evaluation_results!.skill_scores.map((s) => [s.skill_id, s.skills] as const))).entries()] };
  });

  const attempts = job.applications.flatMap((a) => a.assessment_attempts);
  const everPublished = assessments.some((a) => !neverPublished(a));
  const flowDone = [
    true,
    job.job_skills.length > 0,
    Boolean(version),
    Boolean(everPublished),
    attempts.length > 0,
    attempts.some((a) => a.status === 'submitted' && a.evaluation_results),
    attempts.some((a) => a.evaluation_results?.status === 'reviewed'),
    evaluated.length > 0,
  ];

  return (
    <div className="space-y-12">
      <header>
        <Link href={`/organization/${orgId}/jobs`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
          <Arrow className="rotate-180" />{tw('allJobs')}
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-border-strong pb-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-muted"><span aria-hidden className={clsx('size-2 rounded-full', job.status === 'published' ? 'bg-primary' : job.status === 'draft' ? 'bg-gold' : 'bg-border-strong')} />{to(`jobStatus.${job.status}`)}</p>
            <h1 className="display-lg mt-2 text-balance max-sm:text-[2.125rem] max-sm:leading-tight">{pick(locale, job.title_ar, job.title_en)}</h1>
          </div>
          {canBuild && <div className="flex flex-wrap items-center gap-3 sm:ms-auto"><JobStatusButtons orgId={orgId} jobId={jobId} status={job.status} /></div>}
        </div>
        {!wizard && (
          // A progress list, not navigation: the steps aren't links. Their names stay readable at every width.
          <div className="mt-6">
            <ol aria-label={t('flowLabel')} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${flowDone.length}, minmax(0, 1fr))` }}>
              {(t.raw('flow') as string[]).map((label, i) => {
                const current = i === flowDone.indexOf(false);
                return (
                  <li key={label} aria-current={current ? 'step' : undefined}>
                    <span aria-hidden className={clsx('block h-1.5 rounded-full', flowDone[i] ? 'bg-primary' : current ? 'bg-gold' : 'bg-surface-2')} />
                    <span className={clsx('mt-2 text-xs leading-snug max-lg:sr-only lg:block', current ? 'font-semibold' : flowDone[i] ? 'text-foreground/80' : 'text-muted')}>{label}</span>
                    <span className="sr-only">{flowDone[i] ? tw('ready') : ''}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </header>

      {wizard ? (
        <nav aria-label={tw('stepsLabel')}>
          <div className="flex items-baseline justify-between gap-4">
            <p className="label-caps">{tw('stepsLabel')}</p>
            <p className="num text-sm text-muted">{tw('progress', { step: number(locale, stepNo + 1), total: number(locale, WIZARD.length + 1) })}</p>
          </div>
          <ol className="mt-3 grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${WIZARD.length + 1}, minmax(0, 1fr))` }}>
            {[tw('stepName1'), ...WIZARD.map((w) => tw(`step.${w}`))].map((label, i) => {
              const state = i === stepNo ? 'current' : i < stepNo ? 'done' : 'next';
              const body = (
                <>
                  <span aria-hidden className={clsx('block h-1.5 rounded-full', state === 'done' ? 'bg-primary' : state === 'current' ? 'bg-gold' : 'bg-surface-2')} />
                  <span className={clsx('mt-2.5 hidden items-center gap-1.5 text-sm sm:flex', state === 'current' ? 'font-semibold' : state === 'done' ? 'text-foreground/80' : 'text-muted')}>
                    {state === 'done' ? <Icon name="check" className="size-3.5 shrink-0 text-primary" /> : <span className="num text-xs">{number(locale, i + 1)}</span>}
                    <span className="truncate">{label}</span>
                  </span>
                </>
              );
              return (
                <li key={label} aria-current={state === 'current' ? 'step' : undefined}>
                  {state === 'current' ? <span className="block">{body}</span>
                    : <Link href={i === 0 ? `/organization/${orgId}/jobs/${jobId}` : `/organization/${orgId}/jobs/${jobId}?step=${i}`} className="block hover:opacity-80">{body}</Link>}
                </li>
              );
            })}
          </ol>
          <p className="mt-5 text-muted">{tw(`stepLead.${wizard}`)}</p>
        </nav>
      ) : (
      <nav aria-label={t('onThisPage')} className="sticky top-[4.5rem] z-20 -mx-4 border-y border-border bg-background/95 px-4 backdrop-blur lg:mx-0 lg:rounded-[var(--radius-panel)] lg:border-x">
        <ul className="flex gap-1 overflow-x-auto py-1.5">
          {[['details', t('details')], ['requirements', tr('title')], ['reference-skills', tj('title')], ['assessment', t('assessment')], ['candidates', t('candidates')]].map(([id, label], i) => (
            <li key={id} className="shrink-0"><a href={`#${id}`} className="flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"><span className="num text-xs text-gold-text">{String(i + 1).padStart(2, '0')}</span>{label}</a></li>
          ))}
        </ul>
      </nav>
      )}

      {show('details') && (
      <section aria-labelledby="details">
        <h2 id="details" className="section-title mb-6 flex items-baseline gap-3 border-b border-border-strong pb-3"><span className="num text-sm text-gold-text">01</span>{t('details')}</h2>
        <JobDetailsForm orgId={orgId} job={job} skills={skills} canEdit={canBuild} />
      </section>
      )}

      {show('requirements') && (
      <section aria-labelledby="requirements">
        <h2 id="requirements" className="section-title mb-6 flex items-baseline gap-3 border-b border-border-strong pb-3"><span className="num text-sm text-gold-text">02</span>{tr('title')}</h2>
        <RequirementsEditor orgId={orgId} jobId={jobId} requirements={requirements ?? []} versionIds={assessments.flatMap((a) => a.assessment_versions[0]?.id ?? [])} canEdit={canBuild} />
      </section>
      )}

      {show('reference-skills') && (
      <section aria-labelledby="reference-skills">
        <h2 id="reference-skills" className="section-title mb-6 flex items-baseline gap-3 border-b border-border-strong pb-3"><span className="num text-sm text-gold-text">03</span>{tj('title')}</h2>
        <JobAnalysisPanel key={analysis?.id ?? 'none'} orgId={orgId} jobId={jobId} analysis={analysis ?? null} linked={job.job_reference_skills ?? []} custom={custom ?? []} canEdit={canBuild} />
      </section>
      )}

      {show('assessment') && (
      <section aria-labelledby="assessment">
        <h2 id="assessment" className="section-title mb-6 flex items-baseline gap-3 border-b border-border-strong pb-3"><span className="num text-sm text-gold-text">04</span>{t('assessment')}</h2>
        {!version ? (
          canBuild ? <EmptyAssessment orgId={orgId} jobId={jobId} /> : <p className="text-muted">{t('noAssessmentTitle')}</p>
        ) : (
          <div key={version.assessments.id} className="space-y-5">
            <AssessmentSwitcher orgId={orgId} jobId={jobId} assessments={assessments} selected={version.assessments.id} canBuild={canBuild} />
            <AssessmentTitle
              orgId={orgId} jobId={jobId} assessment={version.assessments} canEdit={canBuild}
              canRemove={canBuild && neverPublished(assessments.find((a) => a.id === version.assessments.id))}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">
                {t('version', { n: number(locale, version.version_number) })} · {t(`status.${version.status}`)} · {t('tasksCount', { count: version.assessment_tasks.length, shown: number(locale, version.assessment_tasks.length) })}
              </p>
              <Link href={`/experience/${job.organizations.slug}/${job.slug}/${version.id}`} className="link">{t('preview')}</Link>
            </div>
            {latest.run?.mode === 'demo' && !published && <p className="callout text-sm font-medium">{t('demoLabel')}</p>}
            {published && <p className="callout text-sm font-medium">{t('publishedNote')}</p>}
            {published && <p className="callout text-sm font-medium">{tr('lockedNote')}</p>}
            <FieldSelect orgId={orgId} assessmentId={version.assessments.id} field={version.assessments.professional_field} canEdit={canBuild} />
            {required.length > 0 && (
              <div>
                <p className="text-sm font-semibold">{t('coverage')}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {required.map((s) => (
                    <li key={s.id} className={coveredIds.has(s.id) ? 'rounded-[3px] bg-accent px-2.5 py-1 text-sm font-medium text-accent-foreground' : 'rounded-[3px] border border-error/50 bg-error-surface px-2.5 py-1 text-sm font-medium text-error'}>
                      {pick(locale, s.name_ar, s.name_en)}{!coveredIds.has(s.id) && ` · ${t('uncovered')}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canBuild && <VersionSettings key={version.id} orgId={orgId} version={version} canEdit={Boolean(editable)} />}
            <TaskList orgId={orgId} versionId={version.id} tasks={version.assessment_tasks} editable={Boolean(editable)} requirements={requirements ?? []} />
            {intel && <QualityPanel orgId={orgId} versionId={version.id} quality={intel.quality} canCheck={canBuild && Boolean(editable)} gated={Boolean(intel.guide)} />}
            {intel?.guide && <AssessorGuide guide={intel.guide} />}
            {review && (editable || review.changes.length > 0) && <ChangeReview orgId={orgId} state={review} canReview={canPublish} />}
            {editable && canPublish && (
              <PublishPanel
                orgId={orgId} versionId={version.id}
                uncovered={uncoveredItems(version.assessment_tasks, requirements ?? [], job.job_reference_skills ?? [], (ar, en) => pick(locale, ar ?? en ?? '', en ?? ar ?? ''))}
                review={review ? { latestChangeId: review.latest_change_id, unreviewedChanges, errors: review.validation.filter((f) => f.severity === 'error').length } : undefined}
              />
            )}
            {published && canBuild && (
              <div className="flex flex-wrap items-start gap-6">
                <ReviseButton orgId={orgId} versionId={version.id} />
                <GenerateButton orgId={orgId} jobId={jobId} assessmentId={version.assessments.id} label={t('newVersion')} />
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {!wizard && (
      <section aria-labelledby="candidates">
        <h2 id="candidates" className="section-title mb-6 flex items-baseline gap-3 border-b border-border-strong pb-3"><span className="num text-sm text-gold-text">05</span>{t('candidates')}</h2>
        {job.applications.length === 0 ? (
          <p className="text-muted">{t('noCandidates')}</p>
        ) : (
          <ul className="border-t border-border">
            {job.applications.map((a) => {
              const name = a.users.candidate_profiles?.full_name ?? a.users.email;
              const rows = [
                ...a.assessment_attempts.map((attempt) => ({ id: attempt.assessment_versions.assessment_id, of: attempt.assessment_versions.assessments, attempt })),
                ...liveAssessments.filter((s) => !a.assessment_attempts.some((x) => x.assessment_versions.assessment_id === s.id)).map((s) => ({ id: s.id, of: s, attempt: null })),
              ];
              return (
                <li key={a.id} className="grid items-center gap-3 border-b border-border py-4 sm:grid-cols-[1fr_14rem]">
                  <div className="min-w-0">
                    <Link href={`/organization/${orgId}/applicants/${a.id}`} className="block truncate font-semibold underline-offset-4 hover:text-primary hover:underline">{name}</Link>
                    <p className="mt-1 flex items-center gap-3 text-sm text-muted"><StageMeter status={a.status} label={ts(a.status)} />{ts(a.status)}</p>
                  </div>
                  {canBuild ? <ApplicantStatus id={a.id} status={a.status} label={to('changeStatus', { name })} canReopen={canReopenApplications(org.my_role)} /> : <span className="text-sm">{ts(a.status)}</span>}
                  {rows.length === 0 ? (
                    canBuild && <p className="text-xs text-muted sm:col-span-2">{t('needPublished')}</p>
                  ) : (
                    <ul className="space-y-2 sm:col-span-2">
                      {rows.map(({ id, of, attempt }) => {
                        const title = pick(locale, of.title_ar, of.title_en);
                        return (
                          <li key={id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius-control)] border border-border bg-surface px-3.5 py-2.5 text-sm">
                            <span className="min-w-0 font-medium">{title}{attempt && <span className="ms-2 font-normal text-muted">{t(`attempt.${attempt.status}`)}</span>}</span>
                            {!attempt && canBuild && <InviteButton applicationId={a.id} assessmentId={id} title={title} />}
                            {attempt?.status === 'submitted' && canEvaluate && (
                              <Link href={`/organization/${orgId}/review/${attempt.id}`} className="link">
                                {attempt.evaluation_results?.status === 'reviewed' ? t('viewReview') : t('review')}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {!wizard && (
      <section aria-labelledby="compare">
        <Eyebrow className="mb-2 text-muted"><span id="compare">{t('compare')}</span></Eyebrow>
        {evaluated.length === 0 ? (
          <p className="text-muted">{t('noCompare')}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">{t('compareNote')}</p>
            <div className="space-y-8">
              {compareGroups.map(({ of, rows, skills: compareSkills }) => (
                <div key={of.id}>
                  {compareGroups.length > 1 && <h3 className="mb-2 font-semibold">{t('versionOf', { title: pick(locale, of.assessments.title_ar, of.assessments.title_en), n: number(locale, of.version_number) })}</h3>}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[28rem] text-sm">
                      <thead>
                        <tr className="border-b border-border text-start">
                          <th scope="col" className="py-2 pe-4 text-start font-semibold">{t('candidate')}</th>
                          {compareSkills.map(([id, s]) => <th key={id} scope="col" className="px-2 py-2 text-start font-semibold">{pick(locale, s.name_ar, s.name_en)}</th>)}
                          <th scope="col" className="ps-2 py-2 text-start font-semibold">{t('overall')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr key={c.id} className="border-b border-border">
                            <th scope="row" className="py-2.5 pe-4 text-start font-medium">{c.applications.users.candidate_profiles?.full_name ?? c.applications.users.email}</th>
                            {compareSkills.map(([id]) => <td key={id} className="px-2">L{c.evaluation_results!.skill_scores.find((s) => s.skill_id === id)?.level ?? 0}</td>)}
                            <td className="ps-2 font-semibold">{number(locale, Number(c.evaluation_results!.overall_score))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      )}
      {wizard === 'review' && (
        <section aria-labelledby="review-step" className="space-y-6">
          <h2 id="review-step" className="section-title">{tw('step.review')}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
            {([
              ['details', Boolean(job.description_ar || job.description_en), 1],
              ['requirements', (requirements ?? []).length > 0, 2],
              ['reference-skills', (job.job_reference_skills ?? []).length > 0 || job.job_skills.length > 0, 3],
              ['assessment', Boolean(version), 4],
            ] as const).map(([key, ok, n]) => (
              <li key={key} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span aria-hidden className={ok ? 'grid size-8 place-items-center rounded-full bg-primary text-primary-foreground' : 'grid size-8 place-items-center rounded-full border border-warning text-warning'}>{ok ? '✓' : '!'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{tw(`step.${key}`)}</span>
                  <span className="block text-sm text-muted">{ok ? tw('ready') : tw(`missing.${key}`)}</span>
                </span>
                <Link href={`/organization/${orgId}/jobs/${jobId}?step=${n}`} className="link text-sm">{tw('edit')}</Link>
              </li>
            ))}
          </ul>
          <div className="callout space-y-3">
            <p className="font-semibold">{job.status === 'published' ? tw('alreadyPublished') : tw('publishTitle')}</p>
            <p className="text-sm text-muted">{tw('publishBody')}</p>
            {canBuild && <JobStatusButtons orgId={orgId} jobId={jobId} status={job.status} />}
          </div>
        </section>
      )}

      {wizard && (
        <div className="ob-actions">
          <Link href={stepNo > 1 ? `/organization/${orgId}/jobs/${jobId}?step=${stepNo - 1}` : `/organization/${orgId}/jobs`} className="btn btn-ghost"><Arrow className="rotate-180" />{tw('back')}</Link>
          <span className="flex-1" />
          <span className="flex flex-wrap items-center gap-3">
            <Link href={`/organization/${orgId}/jobs/${jobId}`} className="btn btn-ghost">{tw('saveExit')}</Link>
            {stepNo < WIZARD.length && <Link href={`/organization/${orgId}/jobs/${jobId}?step=${stepNo + 1}`} className="btn btn-primary">{tw('continue')}<Arrow /></Link>}
          </span>
        </div>
      )}
    </div>
  );
}
