import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow } from '@/components/brand';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatDate, number, pick } from '@/lib/format';
import { REQUIREMENT_TYPES, requirementText } from '@/lib/requirements';
import { getSession } from '@/lib/session';

type Job = {
  id: string; status: string; title_ar: string; title_en: string; description_ar: string | null; description_en: string | null;
  location: string | null; is_demo: boolean; organizations: { name_ar: string; name_en: string };
  requirements_ar: string | null; requirements_en: string | null;
  employment_type: string | null; application_deadline: string | null; sector: string | null; experience_level: string | null; salary_min: string | null; salary_max: string | null;
  job_reference_skills: { is_required: boolean; reference_skills: { id: string; name_ar: string; description_ar: string | null } }[];
  assessments: { assessment_id: string; title_ar: string; title_en: string; duration_minutes: number | null; is_timed: boolean; deadline_hours: number | null; tasks: number }[];
  job_skills: { required_level: number; skills: { id: string; name_ar: string; name_en: string } }[];
  job_requirements: { id: string; requirement_type: string; description_ar: string | null; description_en: string | null; is_mandatory: boolean; min_years: string | null }[];
};
type Mine = { id: string; job_id: string; status: string };
type Match = { total: number; percentage: number | null; matched: { id: string; name_ar: string; name_en: string | null; evidence: string }[]; gaps: { id: string; name_ar: string; name_en: string | null }[] };

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
  const match = session && session.accountType !== 'organization' && job.status === 'published' ? await apiForPage<Match>(`/me/jobs/${id}/match`) : null;
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const tr = await getTranslations({ locale, namespace: 'requirements' });
  const ts = await getTranslations({ locale, namespace: 'sectors' });
  const application = mine?.find((a) => a.job_id === id);
  const applied = Boolean(application);
  const salary = job.salary_min || job.salary_max ? [job.salary_min, job.salary_max].filter(Boolean).map((v) => number(locale, Number(v))).join(' – ') : null;
  const skillName = (s: { name_ar: string; name_en: string | null }) => pick(locale, s.name_ar, s.name_en ?? s.name_ar);
  const description = pick(locale, job.description_ar ?? '', job.description_en ?? '');
  return (
    <article className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-16">
      <Link href="/opportunities" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
        <Arrow className="rotate-180 rtl:rotate-0 rtl:scale-x-100" />{t('back')}
      </Link>
      <Eyebrow className="mt-8 text-muted">
        {pick(locale, job.organizations.name_ar, job.organizations.name_en)}{job.location && ` · ${job.location}`}{job.employment_type && ` · ${t(`employment.${job.employment_type}`)}`}
      </Eyebrow>
      <h1 className="mt-4 font-display text-4xl leading-tight font-bold sm:text-5xl">{pick(locale, job.title_ar, job.title_en)}</h1>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-muted">
        {job.sector && <li>{ts(job.sector)}</li>}
        {job.experience_level && <li>{t(`level.${job.experience_level}`)}</li>}
        {job.application_deadline && <li>{t('deadline', { date: formatDate(locale, job.application_deadline, 'UTC') })}</li>}
        {salary && <li>{t('salary', { range: salary })}</li>}
      </ul>
      {job.is_demo && <p className="mt-5 border-s-2 border-gold ps-4 text-sm font-medium">{t('demoNote')}</p>}
      <h2 className="mt-10 font-display text-xl font-semibold">{t('about')}</h2>
      <p className="mt-2 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-muted">{description || t('noDescription')}</p>
      {pick(locale, job.requirements_ar ?? '', job.requirements_en ?? '') && (
        <>
          <h2 className="mt-8 font-display text-xl font-semibold">{t('requirements')}</h2>
          <p className="mt-2 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-muted">{pick(locale, job.requirements_ar ?? '', job.requirements_en ?? '')}</p>
        </>
      )}
      {job.job_requirements.length > 0 && (
        <section aria-label={tr('publicTitle')} className="mt-8 space-y-5">
          {REQUIREMENT_TYPES.filter((k) => job.job_requirements.some((r) => r.requirement_type === k)).map((k) => (
            <div key={k}>
              <h2 className="font-display text-xl font-semibold">{tr(`type.${k}`)}</h2>
              <ul className="mt-2 max-w-2xl list-disc space-y-1 ps-5 text-lg leading-relaxed text-muted">
                {job.job_requirements.filter((r) => r.requirement_type === k).map((r) => (
                  <li key={r.id}>
                    <bdi>{requirementText(locale, r)}</bdi>
                    {r.min_years != null && ` (${tr('years', { count: number(locale, Number(r.min_years)) })})`}
                    {!r.is_mandatory && ` · ${tr('optional')}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {job.job_skills.length > 0 && (
        <>
          <h2 className="mt-8 font-display text-xl font-semibold">{t('skills')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {job.job_skills.map((s) => (
              <li key={s.skills.id} className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">{pick(locale, s.skills.name_ar, s.skills.name_en)}</li>
            ))}
          </ul>
        </>
      )}
      {job.job_reference_skills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {job.job_reference_skills.map((s) => <li key={s.reference_skills.id} title={s.reference_skills.description_ar ?? undefined} className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">{s.reference_skills.name_ar}</li>)}
        </ul>
      )}
      {job.assessments.length > 0 && (
        <section aria-labelledby="assessment-overview" className="mt-8">
          <h2 id="assessment-overview" className="font-display text-xl font-semibold">{t('assessmentTitle')}</h2>
          <p className="mt-1 text-muted">{t('assessmentNote')}</p>
          <ul className="mt-2 space-y-1.5">
            {job.assessments.map((a) => (
              <li key={a.assessment_id} className="font-medium">
                {pick(locale, a.title_ar, a.title_en)}
                <span className="ms-2 text-sm font-normal text-muted">
                  {t('assessmentTasks', { count: number(locale, a.tasks) })}
                  {a.duration_minutes != null && ` · ${t(a.is_timed ? 'assessmentTimed' : 'assessmentEstimated', { minutes: number(locale, a.duration_minutes) })}`}
                  {a.deadline_hours != null && ` · ${t('assessmentDue', { hours: number(locale, a.deadline_hours) })}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {match && match.total > 0 && (
        <section aria-labelledby="your-match" className="mt-8 rounded-lg bg-surface p-5">
          <h2 id="your-match" className="font-display text-xl font-semibold">{t('matchTitle')}</h2>
          {match.percentage != null && <p className="mt-1 font-semibold">{t('matchLine', { matched: number(locale, match.matched.length), total: number(locale, match.total) })}</p>}
          <p className="mt-1 text-sm text-muted">{t('matchNote')}</p>
          {match.matched.length > 0 && (
            <p className="mt-2 text-sm"><span className="font-semibold">{t('matchHave')}: </span>{match.matched.map((s) => `${skillName(s)} (${t(`evidence.${s.evidence}`)})`).join(locale === 'ar' ? '، ' : ', ')}</p>
          )}
          {match.gaps.length > 0 && <p className="mt-1 text-sm"><span className="font-semibold">{t('matchGaps')}: </span>{match.gaps.map(skillName).join(locale === 'ar' ? '، ' : ', ')}</p>}
        </section>
      )}
      <div className="mt-10">
        {applied ? (
          <p role="status" className="font-semibold text-primary">
            {t('applied')}. <Link href={`/applications/${application?.id}`} className="underline underline-offset-4">{t('viewApplication')}</Link>
          </p>
        ) : session?.accountType === 'organization' ? (
          <p className="text-muted">{t('orgCannotApply')}</p>
        ) : session ? (
          <Link href={`/opportunities/${id}/apply`} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{t('apply')}<Arrow /></Link>
        ) : (
          <Link href={`/login?next=/opportunities/${id}/apply`} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">
            {t('signInToApply')}<Arrow />
          </Link>
        )}
      </div>
    </article>
  );
}
