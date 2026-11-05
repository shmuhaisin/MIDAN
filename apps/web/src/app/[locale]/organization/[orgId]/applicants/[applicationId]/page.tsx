import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ApplicantCvButton } from '@/components/profile';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Named = { skill_id: string; skills: { name_ar: string; name_en: string } };
type Experience = { title: string; organization: string; start_year: number; end_year?: number | null; description?: string };
type Education = { institution: string; qualification: string; field?: string; start_year: number; end_year?: number | null };
type Applicant = {
  status: string;
  jobs: { id: string; title_ar: string; title_en: string; job_skills: Named[] };
  assessment_attempts: { id: string; status: string }[];
  users: {
    email: string;
    candidate_skills: Named[];
    candidate_profiles: null | {
      full_name: string; headline: string | null; city: string | null; summary: string | null; years_experience: string | null;
      cv_path: string | null; experience: Experience[]; education: Education[];
    };
  };
};

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string; applicationId: string }> }) {
  const { locale, orgId, applicationId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(applicationId)) notFound();
  const data = await apiForPage<Applicant>(`/applications/${applicationId}/profile`);
  if (!data) notFound();
  const t = await getTranslations({ locale, namespace: 'applicant' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const profile = data.users.candidate_profiles;
  const listed = new Set(data.users.candidate_skills.map((s) => s.skill_id));
  const required = new Set(data.jobs.job_skills.map((s) => s.skill_id));
  const attempt = data.assessment_attempts.find((a) => a.status === 'submitted');
  const span = (i: { start_year: number; end_year?: number | null }) => `${i.start_year} – ${i.end_year ?? t('present')}`;

  return (
    <article className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-6">
      <header>
        <Link href={`/organization/${orgId}/jobs/${data.jobs.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
          <Arrow className="rotate-180" />{t('back')}
        </Link>
        <h1 className="mt-5 font-display text-4xl font-bold">{profile?.full_name ?? data.users.email}</h1>
        {profile?.headline && <p className="mt-1 text-xl">{profile.headline}</p>}
        <p className="mt-2 text-muted">
          {[profile?.city, profile?.years_experience != null ? t('years', { count: number(locale, Number(profile.years_experience)) }) : null].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-2 text-sm font-medium">{t('appliedFor', { job: pick(locale, data.jobs.title_ar, data.jobs.title_en) })} · {ts(data.status)}</p>
        <p className="mt-4 border-s-2 border-gold ps-4 text-sm">{t('privacy')}</p>
        {attempt && (
          <Link href={`/organization/${orgId}/review/${attempt.id}`} className="mt-4 inline-flex items-center gap-2 font-semibold text-primary underline underline-offset-4">{t('viewWork')}<Arrow /></Link>
        )}
      </header>

      {!profile && <p className="text-muted">{t('noProfile')}</p>}
      {profile?.summary && <p className="max-w-3xl text-lg leading-relaxed whitespace-pre-line">{profile.summary}</p>}

      <section aria-labelledby="skills">
        <h2 id="skills" className="font-display text-2xl font-bold">{t('skills')}</h2>
        <p className="mt-1 text-sm text-muted">{t('skillsNote')}</p>
        {data.users.candidate_skills.length === 0 ? <p className="mt-3 text-muted">{t('none')}</p> : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {data.users.candidate_skills.map((s) => (
              <li key={s.skill_id} className={required.has(s.skill_id) ? 'rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground' : 'rounded-full bg-surface-2 px-3 py-1 text-sm'}>
                {pick(locale, s.skills.name_ar, s.skills.name_en)}
                {required.has(s.skill_id) && <span className="sr-only"> ({t('matches')})</span>}
              </li>
            ))}
          </ul>
        )}
        {data.jobs.job_skills.some((s) => !listed.has(s.skill_id)) && (
          <p className="mt-3 text-sm text-muted">
            {t('required')}: {data.jobs.job_skills.filter((s) => !listed.has(s.skill_id)).map((s) => pick(locale, s.skills.name_ar, s.skills.name_en)).join(locale === 'ar' ? '، ' : ', ')} ({t('notListed')})
          </p>
        )}
      </section>

      <section aria-labelledby="experience">
        <h2 id="experience" className="font-display text-2xl font-bold">{t('experience')}</h2>
        {(profile?.experience ?? []).length === 0 ? <p className="mt-3 text-muted">{t('none')}</p> : (
          <ul className="mt-3 border-t border-border">
            {profile?.experience.map((e, i) => (
              <li key={i} className="border-b border-border py-4">
                <p className="font-semibold">{e.title} · {e.organization}</p>
                <p className="text-sm text-muted">{span(e)}</p>
                {e.description && <p className="mt-1 leading-relaxed">{e.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="education">
        <h2 id="education" className="font-display text-2xl font-bold">{t('education')}</h2>
        {(profile?.education ?? []).length === 0 ? <p className="mt-3 text-muted">{t('none')}</p> : (
          <ul className="mt-3 border-t border-border">
            {profile?.education.map((e, i) => (
              <li key={i} className="border-b border-border py-4">
                <p className="font-semibold">{e.qualification}{e.field && ` · ${e.field}`}</p>
                <p className="text-sm text-muted">{e.institution} · {span(e)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cv">
        <h2 id="cv" className="font-display text-2xl font-bold">{t('cv')}</h2>
        <div className="mt-3">{profile?.cv_path ? <ApplicantCvButton applicationId={applicationId} /> : <p className="text-muted">{t('cvNone')}</p>}</div>
      </section>
    </article>
  );
}
