import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ApplyPanel, type CvDocument } from '@/components/candidate';
import { Icon } from '@/components/icons';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';
import { candidateOnly } from '@/lib/account';

type Job = {
  id: string; title_ar: string; title_en: string; status: string; organizations: { name_ar: string; name_en: string };
  assessments: { assessment_id: string; title_ar: string; title_en: string; duration_minutes: number | null; deadline_hours: number | null }[];
};
type Me = {
  email: string;
  candidate_profiles: { full_name: string; phone: string | null; city: string | null; headline: string | null; cv_path: string | null } | null;
};
type Mine = { id: string; job_id: string };

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // Only candidate accounts apply; an organization account goes to its workspace.
  await candidateOnly(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!(await getSession())) return redirect({ href: `/login?next=/opportunities/${id}/apply`, locale });
  const [job, me, mine, documents] = await Promise.all([apiForPage<Job>(`/jobs/${id}`), apiForPage<Me>('/me'), apiForPage<Mine[]>('/me/applications'), apiForPage<CvDocument[]>('/me/cv/documents').then((d) => d ?? [])]);
  if (!job || job.status !== 'published') notFound();
  const existing = mine?.find((a) => a.job_id === id);
  if (existing) return redirect({ href: `/applications/${existing.id}`, locale });
  const t = await getTranslations({ locale, namespace: 'apply' });
  const profile = me?.candidate_profiles;
  const step = (n: number, title: string, id: string, children: React.ReactNode) => (
    <section aria-labelledby={id} className="relative grid gap-4 ps-12">
      <span aria-hidden className="num absolute start-0 top-0 grid size-8 place-items-center rounded-full border border-gold bg-background text-sm font-bold text-gold-text">{number(locale, n)}</span>
      <h2 id={id} className="section-title pt-0.5">{title}</h2>
      {children}
    </section>
  );
  return (
    <section className="container-page max-w-3xl py-10 lg:py-14">
      <Link href={`/opportunities/${id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground"><Icon name="chevron" className="size-4 rotate-180" />{t('back')}</Link>
      <p className="mt-8 text-sm font-semibold text-muted">{pick(locale, job.organizations.name_ar, job.organizations.name_en)}</p>
      <h1 className="display-lg mt-2 text-balance">{t('title', { job: pick(locale, job.title_ar, job.title_en) })}</h1>
      {!profile ? (
        <div className="callout mt-10 space-y-3">
          <p>{t('needProfile')}</p>
          <Link href="/onboarding" className="btn btn-primary">{t('completeProfile')}<Arrow /></Link>
        </div>
      ) : (
        <div className="relative mt-12 space-y-12">
          <span aria-hidden className="absolute start-4 top-8 bottom-8 w-px bg-border-strong" />
          {step(1, t('reviewInfo'), 'review-info', (
            <div className="panel panel-body">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
                <dt className="text-sm text-muted">{t('name')}</dt><dd className="font-medium">{profile.full_name}</dd>
                <dt className="text-sm text-muted">{t('email')}</dt><dd className="font-medium" dir="ltr">{me?.email}</dd>
                {profile.phone && <><dt className="text-sm text-muted">{t('phone')}</dt><dd className="font-medium" dir="ltr">{profile.phone}</dd></>}
                {profile.city && <><dt className="text-sm text-muted">{t('city')}</dt><dd className="font-medium">{profile.city}</dd></>}
                {profile.headline && <><dt className="text-sm text-muted">{t('headline')}</dt><dd className="font-medium">{profile.headline}</dd></>}
                <dt className="text-sm text-muted">{t('cv')}</dt>
                <dd className="flex items-center gap-2 font-medium">
                  {profile.cv_path ? <><Icon name="check" className="size-4 text-success" />{t('cvAttached')}</> : t('cvNone')}
                </dd>
              </dl>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <p className="max-w-md text-sm text-muted">{t('snapshotNote')}</p>
                <Link href="/profile" className="btn btn-secondary btn-sm">{t('edit')}</Link>
              </div>
            </div>
          ))}
          {job.assessments.length > 0 && step(2, t('nextTitle'), 'next-assessment', (
            <div>
              <p className="text-muted">{t('nextBody')}</p>
              <ul className="mt-3 divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-surface">
                {job.assessments.map((a) => (
                  <li key={a.assessment_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="flex items-center gap-2 font-medium"><Icon name="file" className="size-4 text-primary" />{pick(locale, a.title_ar, a.title_en)}</span>
                    {a.deadline_hours != null && <span className="text-sm text-muted">{t('dueIn', { hours: number(locale, a.deadline_hours) })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {step(job.assessments.length > 0 ? 3 : 2, t('submit'), 'submit-application', <ApplyPanel jobId={id} documents={documents} />)}
        </div>
      )}
    </section>
  );
}
