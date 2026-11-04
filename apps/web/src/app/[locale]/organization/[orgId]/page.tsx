import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Eyebrow, Parapet } from '@/components/brand';
import { ApplicantStatus, JobForm, JobStatusButtons } from '@/components/forms';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Organization = { id: string; name_ar: string; name_en: string; my_role: string };
type Job = { id: string; title_ar: string; title_en: string; status: string };
type Applicant = {
  id: string; status: string;
  jobs: { title_ar: string; title_en: string };
  users: { email: string; candidate_profiles: { full_name: string; headline: string | null } | null };
};

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const [org, jobs, applicants] = await Promise.all([
    apiForPage<Organization>(`/organizations/${orgId}`),
    apiForPage<Job[]>(`/organizations/${orgId}/jobs`),
    apiForPage<Applicant[]>(`/organizations/${orgId}/applications`),
  ]);
  if (!org || !jobs || !applicants) notFound();
  const t = await getTranslations({ locale, namespace: 'org' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tb = await getTranslations({ locale, namespace: 'branding' });
  const canManage = ['owner', 'admin', 'recruiter'].includes(org.my_role);
  const metrics = [
    ['open', jobs.filter((j) => j.status === 'published').length],
    ['draft', jobs.filter((j) => j.status === 'draft').length],
    ['new', applicants.filter((a) => a.status === 'submitted').length],
    ['review', applicants.filter((a) => a.status === 'under_review').length],
  ] as const;

  return (
    <>
      <section className="on-deep bg-deep text-deep-foreground">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <Eyebrow className="text-deep-muted">{t('eyebrow')}</Eyebrow>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{pick(locale, org.name_ar, org.name_en)}</h1>
          <p className="mt-2 text-deep-muted">
            {t('yourRole', { role: td(`role.${org.my_role}`) })} ·{' '}
            <Link href={`/organization/${orgId}/settings`} className="font-semibold text-mint underline underline-offset-4">{tb('link')}</Link>
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {metrics.map(([key, value]) => (
              <div key={key} className="border-s border-mint/30 ps-4">
                <dd className="font-display text-4xl font-bold text-mint">{number(locale, value)}</dd>
                <dt className="mt-1 text-sm text-deep-muted">{t(`metrics.${key}`)}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <Parapet className="rotate-180 text-deep" />

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6">
        <section aria-labelledby="jobs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="jobs" className="font-display text-2xl font-bold">{t('jobs')}</h2>
          </div>
          {canManage && <div className="mt-4"><JobForm orgId={orgId} /></div>}
          {jobs.length === 0 ? (
            <p className="mt-4 text-muted">{t('noJobs')}</p>
          ) : (
            <ul className="mt-4 border-t border-border">
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', job.status === 'published' ? 'bg-accent text-accent-foreground' : 'bg-surface-2 text-muted')}>
                      {t(`jobStatus.${job.status}`)}
                    </span>
                    <Link href={`/organization/${orgId}/jobs/${job.id}`} className="font-semibold underline-offset-4 hover:text-primary hover:underline">{pick(locale, job.title_ar, job.title_en)}</Link>
                  </div>
                  {canManage && <JobStatusButtons orgId={orgId} jobId={job.id} status={job.status} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="applicants">
          <h2 id="applicants" className="font-display text-2xl font-bold">{t('applicants')}</h2>
          <p className="mt-1 text-sm text-muted">{t('humanNote')}</p>
          {applicants.length === 0 ? (
            <p className="mt-4 text-muted">{t('noApplicants')}</p>
          ) : (
            <ul className="mt-4 border-t border-border">
              {applicants.map((a) => {
                const name = a.users.candidate_profiles?.full_name ?? a.users.email;
                return (
                  <li key={a.id} className="grid gap-3 border-b border-border py-4 sm:grid-cols-[1fr_1fr_14rem] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{name}</p>
                      <p className="truncate text-sm text-muted">{a.users.candidate_profiles?.headline ?? t('noProfile')}</p>
                    </div>
                    <p className="text-sm">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</p>
                    {canManage ? (
                      <ApplicantStatus id={a.id} status={a.status} label={t('changeStatus', { name })} />
                    ) : (
                      <p className="text-sm text-muted">{t('readOnly')}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
