import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { Icon } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { CandidateRequirementMatch, type RequirementRow } from '@/components/requirement-match';
import { apiForPage } from '@/lib/api';
import { formatDate, number, pick } from '@/lib/format';
import { REQUIREMENT_TYPES, requirementText } from '@/lib/requirements';
import { myAccount } from '@/lib/account';
import { getSession } from '@/lib/session';

type Job = {
  id: string; status: string; title_ar: string; title_en: string; description_ar: string | null; description_en: string | null;
  location: string | null; is_demo: boolean; organizations: { name_ar: string; name_en: string; employer_registry: { id: string; name_ar: string; name_en: string } | null };
  requirements_ar: string | null; requirements_en: string | null;
  employment_type: string | null; application_deadline: string | null; sector: string | null; experience_level: string | null; salary_min: string | null; salary_max: string | null;
  job_reference_skills: { is_required: boolean; reference_skills: { id: string; name_ar: string; description_ar: string | null } }[];
  assessments: { assessment_id: string; title_ar: string; title_en: string; duration_minutes: number | null; is_timed: boolean; deadline_hours: number | null; tasks: number }[];
  job_skills: { required_level: number; skills: { id: string; name_ar: string; name_en: string } }[];
  job_requirements: { id: string; requirement_type: string; description_ar: string | null; description_en: string | null; is_mandatory: boolean; min_years: string | null }[];
};
type Mine = { id: string; job_id: string; status: string };
type Match = {
  total: number; percentage: number | null; matched: { id: string; name_ar: string; name_en: string | null; evidence: string }[]; gaps: { id: string; name_ar: string; name_en: string | null }[];
  // Requirement by requirement, from the analysis service; `error` when it was unavailable (the skills match still shows).
  semantic?: { requirements: RequirementRow[] } | { error: string };
};

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const session = await getSession();
  const [job, mine] = await Promise.all([
    apiForPage<Job>(`/jobs/${id}`),
    session ? apiForPage<Mine[]>('/me/applications') : null,
  ]);
  if (!job) notFound();
  // An organization account (a membership and no candidate profile, as the database records it) can't apply.
  const account = session ? await myAccount() : null;
  const isOrganization = session?.accountType === 'organization' || Boolean(account && !account.candidate_profiles && account.organization_members.length > 0);
  const match = session && !isOrganization && job.status === 'published' ? await apiForPage<Match>(`/me/jobs/${id}/match`) : null;
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const tm = await getTranslations({ locale, namespace: 'match' });
  const tr = await getTranslations({ locale, namespace: 'requirements' });
  const ts = await getTranslations({ locale, namespace: 'sectors' });
  const application = mine?.find((a) => a.job_id === id);
  const applied = Boolean(application);
  const salary = job.salary_min || job.salary_max ? [job.salary_min, job.salary_max].filter(Boolean).map((v) => number(locale, Number(v))).join(' – ') : null;
  const skillName = (s: { name_ar: string; name_en: string | null }) => pick(locale, s.name_ar, s.name_en ?? s.name_ar);
  const description = pick(locale, job.description_ar ?? '', job.description_en ?? '');
  const org = pick(locale, job.organizations.name_ar, job.organizations.name_en);
  const requirementsText = pick(locale, job.requirements_ar ?? '', job.requirements_en ?? '');
  const facts = [
    job.location && [t('location'), job.location],
    job.employment_type && [t('employmentType'), t(`employment.${job.employment_type}`)],
    job.experience_level && [t('experienceLevel'), t(`level.${job.experience_level}`)],
    job.sector && [t('sector'), ts(job.sector)],
    salary && [t('salaryLabel'), salary],
  ].filter(Boolean) as [string, string][];

  const action = applied ? (
    <p role="status" className="flex items-start gap-2 font-semibold text-success">
      <Icon name="check" className="mt-0.5 size-5" />
      <span>{t('applied')}. <Link href={`/applications/${application?.id}`} className="link">{t('viewApplication')}</Link></span>
    </p>
  ) : isOrganization ? (
    <p className="text-sm text-muted">{t('orgCannotApply')}</p>
  ) : session ? (
    <Link href={`/opportunities/${id}/apply`} className="btn btn-primary btn-lg btn-block">{t('apply')}<Arrow /></Link>
  ) : (
    <Link href={`/login?next=/opportunities/${id}/apply`} className="btn btn-primary btn-lg btn-block">{t('signInToApply')}<Arrow /></Link>
  );

  return (
    <article>
      <header className="border-b border-border bg-surface">
        <div className="container-page py-8 lg:py-12">
          <Link href="/opportunities" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
            <Icon name="chevron" className="size-4 rotate-180" />{t('back')}
          </Link>
          <div className="mt-6 flex flex-wrap items-start gap-5">
            <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-[var(--radius-panel)] bg-deep font-display text-2xl font-bold text-mint">{org.trim().charAt(0)}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold">{org}</span>
                {job.organizations.employer_registry && (
                  <Link href={`/employers/${job.organizations.employer_registry.id}`} className="link text-sm">{t('employerProfile')}</Link>
                )}
              </p>
              <h1 className="display-lg mt-2 text-balance">{pick(locale, job.title_ar, job.title_en)}</h1>
            </div>
          </div>
          {facts.length > 0 && (
            <dl className="mt-8 flex flex-wrap gap-px overflow-hidden rounded-[var(--radius-panel)] border border-border bg-border">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-[9rem] flex-1 bg-background px-4 py-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      <div className="container-page grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14 lg:py-14">
        <div className="min-w-0 space-y-12">
          {job.is_demo && <p className="callout text-sm font-medium">{t('demoNote')}</p>}
          <section aria-labelledby="about-role">
            <h2 id="about-role" className="section-title">{t('about')}</h2>
            <p className="mt-3 text-lg leading-relaxed whitespace-pre-line text-foreground/85">{description || t('noDescription')}</p>
          </section>
          {requirementsText && (
            <section aria-labelledby="req-text">
              <h2 id="req-text" className="section-title">{t('requirements')}</h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-foreground/85">{requirementsText}</p>
            </section>
          )}
          {job.job_requirements.length > 0 && (
            <section aria-label={tr('publicTitle')} className="grid gap-8 sm:grid-cols-2">
              {REQUIREMENT_TYPES.filter((k) => job.job_requirements.some((r) => r.requirement_type === k)).map((k) => (
                <div key={k}>
                  <h2 className="subsection-title border-b border-border pb-2">{tr(`type.${k}`)}</h2>
                  <ul className="mt-3 space-y-2.5 leading-relaxed">
                    {job.job_requirements.filter((r) => r.requirement_type === k).map((r) => (
                      <li key={r.id} className="flex gap-2.5">
                        <span aria-hidden className={`mt-2.5 size-1.5 shrink-0 rotate-45 ${r.is_mandatory ? 'bg-gold' : 'border border-border-strong'}`} />
                        <span>
                          <bdi>{requirementText(locale, r)}</bdi>
                          {r.min_years != null && <span className="text-muted"> ({tr('years', { count: number(locale, Number(r.min_years)) })})</span>}
                          {!r.is_mandatory && <span className="text-muted"> · {tr('optional')}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          {(job.job_skills.length > 0 || job.job_reference_skills.length > 0) && (
            <section aria-labelledby="role-skills">
              <h2 id="role-skills" className="section-title">{t('skills')}</h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {job.job_skills.map((s) => (
                  <li key={s.skills.id} className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm font-medium">{pick(locale, s.skills.name_ar, s.skills.name_en)}</li>
                ))}
                {job.job_reference_skills.map((s) => (
                  <li key={s.reference_skills.id} title={s.reference_skills.description_ar ?? undefined} className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm font-medium">{s.reference_skills.name_ar}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
          <div className="panel overflow-hidden">
            <div className="h-1 bg-gold" />
            <div className="panel-body space-y-4">
              {job.application_deadline && (
                <p className="flex items-center gap-2 text-sm"><Icon name="clock" className="size-4 text-muted" />{t('deadline', { date: formatDate(locale, job.application_deadline, 'UTC') })}</p>
              )}
              {action}
            </div>
          </div>
          {match && match.semantic && 'requirements' in match.semantic && match.semantic.requirements.length > 0 && (
            <section aria-labelledby="your-requirements" className="panel panel-body">
              <h2 id="your-requirements" className="subsection-title">{tm('candidateTitle')}</h2>
              <p className="mt-1 text-xs text-muted">{tm('candidateLead')}</p>
              <CandidateRequirementMatch requirements={match.semantic.requirements} />
            </section>
          )}
          {match && match.semantic && 'error' in match.semantic && <p className="text-xs text-muted">{tm('candidateUnavailable')}</p>}
          {match && match.total > 0 && (
            <section aria-labelledby="your-match" className="panel panel-body">
              <h2 id="your-match" className="subsection-title">{t('matchTitle')}</h2>
              {match.percentage != null && (
                <>
                  <p className="mt-2 font-semibold">{t('matchLine', { matched: number(locale, match.matched.length), total: number(locale, match.total) })}</p>
                  <span aria-hidden className="mt-2 flex gap-1">
                    {Array.from({ length: match.total }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < match.matched.length ? 'bg-primary' : 'bg-surface-2'}`} />)}
                  </span>
                </>
              )}
              <p className="mt-2 text-xs text-muted">{t('matchNote')}</p>
              {match.matched.length > 0 && (
                <p className="mt-3 text-sm"><span className="font-semibold">{t('matchHave')}: </span>{match.matched.map((s) => `${skillName(s)} (${t(`evidence.${s.evidence}`)})`).join(locale === 'ar' ? '، ' : ', ')}</p>
              )}
              {match.gaps.length > 0 && <p className="mt-1.5 text-sm"><span className="font-semibold">{t('matchGaps')}: </span>{match.gaps.map(skillName).join(locale === 'ar' ? '، ' : ', ')}</p>}
            </section>
          )}
          {job.assessments.length > 0 && (
            <section aria-labelledby="assessment-overview" className="panel panel-body">
              <h2 id="assessment-overview" className="subsection-title flex items-center gap-2"><Icon name="file" className="size-4 text-primary" />{t('assessmentTitle')}</h2>
              <p className="mt-1.5 text-sm text-muted">{t('assessmentNote')}</p>
              <ul className="mt-3 divide-y divide-border">
                {job.assessments.map((a) => (
                  <li key={a.assessment_id} className="py-2.5">
                    <span className="block font-medium">{pick(locale, a.title_ar, a.title_en)}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {t('assessmentTasks', { count: number(locale, a.tasks) })}
                      {a.duration_minutes != null && ` · ${t(a.is_timed ? 'assessmentTimed' : 'assessmentEstimated', { minutes: number(locale, a.duration_minutes) })}`}
                      {a.deadline_hours != null && ` · ${t('assessmentDue', { hours: number(locale, a.deadline_hours) })}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}
