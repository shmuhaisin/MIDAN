import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow, JourneyRail } from '@/components/brand';
import { ApplicantStatus, JobStatusButtons } from '@/components/forms';
import { EmptyAssessment, FieldSelect, GenerateButton, InviteButton, JobDetailsForm, PublishPanel, TaskList } from '@/components/workspace';
import { Link, redirect } from '@/i18n/navigation';
import { api, apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Attempt = { id: string; status: string; evaluation_results: { id: string; status: string; released_to_candidate: boolean } | null };
type Job = {
  id: string; slug: string; status: string; title_ar: string; title_en: string; description_ar: string | null; description_en: string | null;
  requirements_ar: string | null; requirements_en: string | null; location: string | null;
  organizations: { slug: string };
  job_skills: { skill_id: string; required_level: number }[];
  applications: { id: string; status: string; users: { email: string; candidate_profiles: { full_name: string; headline: string | null } | null }; assessment_attempts: Attempt[] }[];
};
type Skill = { id: string; name_ar: string; name_en: string };
type Latest = {
  run: { mode: string } | null;
  version: null | {
    id: string; version_number: number; status: string;
    assessments: { id: string; professional_field: string | null };
    assessment_tasks: {
      id: string; position: number; task_type: string; title_ar: string; title_en: string; instructions_ar: string; instructions_en: string; weight: string;
      rubric_criteria: { id: string; code: string; description_ar: string; description_en: string; max_score: string; weight: string; answer_key: unknown }[];
      task_skill_mappings: { skills: Skill }[];
    }[];
  };
};
type Compared = {
  id: string;
  applications: { users: { email: string; candidate_profiles: { full_name: string } | null } };
  evaluation_results: null | { status: string; overall_score: string | null; skill_scores: { skill_id: string; level: number; skills: { name_ar: string; name_en: string } }[] };
};

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string; jobId: string }> }) {
  const { locale, orgId, jobId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId) || !/^[0-9a-f-]{36}$/.test(jobId)) notFound();
  const [org, job, skills, latest, compared] = await Promise.all([
    apiForPage<{ my_role: string }>(`/organizations/${orgId}`),
    apiForPage<Job>(`/organizations/${orgId}/jobs/${jobId}`),
    api<Skill[]>('/skills'),
    apiForPage<Latest>(`/organizations/${orgId}/jobs/${jobId}/assessment`),
    apiForPage<Compared[]>(`/organizations/${orgId}/jobs/${jobId}/report`),
  ]);
  if (!org || !job || !latest) notFound();
  const t = await getTranslations({ locale, namespace: 'workspace' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const to = await getTranslations({ locale, namespace: 'org' });

  const canBuild = ['owner', 'admin', 'recruiter'].includes(org.my_role);
  const canPublish = ['owner', 'admin'].includes(org.my_role);
  const canEvaluate = ['owner', 'admin', 'reviewer'].includes(org.my_role);
  const version = latest.version;
  const editable = version?.status === 'draft' && canBuild;
  const published = version?.status === 'published';
  const coveredIds = new Set(version?.assessment_tasks.flatMap((x) => x.task_skill_mappings.map((m) => m.skills.id)));
  const required = skills.filter((s) => job.job_skills.some((j) => j.skill_id === s.id));

  const evaluated = (compared ?? []).filter((c) => c.evaluation_results?.status === 'reviewed');
  const compareSkills = [...new Map(evaluated.flatMap((c) => c.evaluation_results!.skill_scores.map((s) => [s.skill_id, s.skills] as const))).entries()];

  const attempts = job.applications.flatMap((a) => a.assessment_attempts);
  const everPublished = published || version?.status === 'archived' || (version?.version_number ?? 0) > 1;
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
    <div className="mx-auto max-w-5xl space-y-14 px-4 py-10 sm:px-6">
      <header>
        <Link href={`/organization/${orgId}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
          <Arrow className="rotate-180" />{t('back')}
        </Link>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-4xl font-bold">{pick(locale, job.title_ar, job.title_en)}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold">{to(`jobStatus.${job.status}`)}</span>
            {canBuild && <JobStatusButtons orgId={orgId} jobId={jobId} status={job.status} />}
          </div>
        </div>
        <div className="mt-6"><JourneyRail label={t('flowLabel')} steps={t.raw('flow') as string[]} done={flowDone} /></div>
      </header>

      <section aria-labelledby="details">
        <Eyebrow className="mb-4 text-muted"><span id="details">{t('details')}</span></Eyebrow>
        <JobDetailsForm orgId={orgId} job={job} skills={skills} canEdit={canBuild} />
      </section>

      <section aria-labelledby="assessment">
        <Eyebrow className="mb-4 text-muted"><span id="assessment">{t('assessment')}</span></Eyebrow>
        {!version ? (
          canBuild ? <EmptyAssessment orgId={orgId} jobId={jobId} /> : <p className="text-muted">{t('noAssessmentTitle')}</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">
                {t('version', { n: number(locale, version.version_number) })} · {t(`status.${version.status}`)} · {t('tasksCount', { count: version.assessment_tasks.length, shown: number(locale, version.assessment_tasks.length) })}
              </p>
              <Link href={`/experience/${job.organizations.slug}/${job.slug}/${version.version_number}`} className="font-semibold text-primary underline underline-offset-4">{t('preview')}</Link>
            </div>
            {latest.run?.mode === 'demo' && !published && <p className="border-s-2 border-gold ps-4 text-sm font-medium">{t('demoLabel')}</p>}
            {published && <p className="border-s-2 border-gold ps-4 text-sm font-medium">{t('publishedNote')}</p>}
            <FieldSelect orgId={orgId} assessmentId={version.assessments.id} field={version.assessments.professional_field} canEdit={canBuild} />
            {required.length > 0 && (
              <div>
                <p className="text-sm font-semibold">{t('coverage')}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {required.map((s) => (
                    <li key={s.id} className={coveredIds.has(s.id) ? 'rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground' : 'rounded-full border border-error px-3 py-1 text-sm font-medium'}>
                      {pick(locale, s.name_ar, s.name_en)}{!coveredIds.has(s.id) && ` · ${t('uncovered')}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <TaskList orgId={orgId} tasks={version.assessment_tasks} editable={Boolean(editable)} />
            {editable && canPublish && <PublishPanel orgId={orgId} versionId={version.id} />}
            {published && canBuild && <GenerateButton orgId={orgId} jobId={jobId} label={t('newVersion')} />}
          </div>
        )}
      </section>

      <section aria-labelledby="candidates">
        <Eyebrow className="mb-4 text-muted"><span id="candidates">{t('candidates')}</span></Eyebrow>
        {job.applications.length === 0 ? (
          <p className="text-muted">{t('noCandidates')}</p>
        ) : (
          <ul className="border-t border-border">
            {job.applications.map((a) => {
              const name = a.users.candidate_profiles?.full_name ?? a.users.email;
              const attempt = a.assessment_attempts[0];
              return (
                <li key={a.id} className="grid items-center gap-3 border-b border-border py-4 sm:grid-cols-[1fr_12rem_auto]">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{name}</p>
                    <p className="text-sm text-muted">{attempt ? t(`attempt.${attempt.status}`) : ts(a.status)}</p>
                  </div>
                  {canBuild ? <ApplicantStatus id={a.id} status={a.status} label={to('changeStatus', { name })} /> : <span className="text-sm">{ts(a.status)}</span>}
                  <div className="sm:text-end">
                    {!attempt && canBuild && (published ? <InviteButton applicationId={a.id} /> : <span className="text-xs text-muted">{t('needPublished')}</span>)}
                    {attempt?.status === 'submitted' && canEvaluate && (
                      <Link href={`/organization/${orgId}/review/${attempt.id}`} className="font-semibold text-primary underline underline-offset-4">
                        {attempt.evaluation_results?.status === 'reviewed' ? t('viewReview') : t('review')}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="compare">
        <Eyebrow className="mb-2 text-muted"><span id="compare">{t('compare')}</span></Eyebrow>
        {evaluated.length === 0 ? (
          <p className="text-muted">{t('noCompare')}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">{t('compareNote')}</p>
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
                  {evaluated.map((c) => (
                    <tr key={c.id} className="border-b border-border">
                      <th scope="row" className="py-2.5 pe-4 text-start font-medium">{c.applications.users.candidate_profiles?.full_name ?? c.applications.users.email}</th>
                      {compareSkills.map(([id]) => <td key={id} className="px-2">L{c.evaluation_results!.skill_scores.find((s) => s.skill_id === id)?.level ?? 0}</td>)}
                      <td className="ps-2 font-semibold">{number(locale, Number(c.evaluation_results!.overall_score))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
