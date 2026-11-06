import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ApplyPanel } from '@/components/candidate';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

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
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  if (!(await getSession())) return redirect({ href: `/login?next=/opportunities/${id}/apply`, locale });
  const [job, me, mine] = await Promise.all([apiForPage<Job>(`/jobs/${id}`), apiForPage<Me>('/me'), apiForPage<Mine[]>('/me/applications')]);
  if (!job || job.status !== 'published') notFound();
  const existing = mine?.find((a) => a.job_id === id);
  if (existing) return redirect({ href: `/applications/${existing.id}`, locale });
  const t = await getTranslations({ locale, namespace: 'apply' });
  const profile = me?.candidate_profiles;
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href={`/opportunities/${id}`} className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>
      <h1 className="mt-5 font-display text-4xl font-bold">{t('title', { job: pick(locale, job.title_ar, job.title_en) })}</h1>
      <p className="mt-2 text-lg text-muted">{pick(locale, job.organizations.name_ar, job.organizations.name_en)}</p>
      {!profile ? (
        <div className="mt-8 space-y-3">
          <p>{t('needProfile')}</p>
          <Link href="/onboarding" className="inline-flex items-center gap-2 font-semibold text-primary underline underline-offset-4">{t('completeProfile')}<Arrow /></Link>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <section aria-labelledby="review-info" className="rounded-lg bg-surface p-5">
            <h2 id="review-info" className="font-display text-xl font-semibold">{t('reviewInfo')}</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="text-sm text-muted">{t('name')}</dt><dd className="font-medium">{profile.full_name}</dd>
              <dt className="text-sm text-muted">{t('email')}</dt><dd className="font-medium" dir="ltr">{me?.email}</dd>
              {profile.phone && <><dt className="text-sm text-muted">{t('phone')}</dt><dd className="font-medium" dir="ltr">{profile.phone}</dd></>}
              {profile.city && <><dt className="text-sm text-muted">{t('city')}</dt><dd className="font-medium">{profile.city}</dd></>}
              {profile.headline && <><dt className="text-sm text-muted">{t('headline')}</dt><dd className="font-medium">{profile.headline}</dd></>}
              <dt className="text-sm text-muted">{t('cv')}</dt><dd className="font-medium">{profile.cv_path ? t('cvAttached') : t('cvNone')}</dd>
            </dl>
            <Link href="/profile" className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4">{t('edit')}</Link>
            <p className="mt-3 text-sm text-muted">{t('snapshotNote')}</p>
          </section>
          {job.assessments.length > 0 && (
            <section aria-labelledby="next-assessment">
              <h2 id="next-assessment" className="font-display text-xl font-semibold">{t('nextTitle')}</h2>
              <p className="mt-1 text-muted">{t('nextBody')}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {job.assessments.map((a) => (
                  <li key={a.assessment_id}>
                    {pick(locale, a.title_ar, a.title_en)}
                    {a.deadline_hours != null && ` · ${t('dueIn', { hours: number(locale, a.deadline_hours) })}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ApplyPanel jobId={id} hasCv={Boolean(profile.cv_path)} />
        </div>
      )}
    </section>
  );
}
