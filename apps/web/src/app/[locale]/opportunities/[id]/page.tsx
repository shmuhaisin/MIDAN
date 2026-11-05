import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow } from '@/components/brand';
import { ApplyButton } from '@/components/forms';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Job = {
  id: string; status: string; title_ar: string; title_en: string; description_ar: string | null; description_en: string | null;
  location: string | null; is_demo: boolean; organizations: { name_ar: string; name_en: string };
  requirements_ar: string | null; requirements_en: string | null;
  job_skills: { required_level: number; skills: { id: string; name_ar: string; name_en: string } }[];
};
type Mine = { job_id: string; status: string };

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
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const applied = mine?.some((a) => a.job_id === id);
  const description = pick(locale, job.description_ar ?? '', job.description_en ?? '');
  return (
    <article className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-16">
      <Link href="/opportunities" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
        <Arrow className="rotate-180 rtl:rotate-0 rtl:scale-x-100" />{t('back')}
      </Link>
      <Eyebrow className="mt-8 text-muted">
        {pick(locale, job.organizations.name_ar, job.organizations.name_en)}{job.location && ` · ${job.location}`}
      </Eyebrow>
      <h1 className="mt-4 font-display text-4xl leading-tight font-bold sm:text-5xl">{pick(locale, job.title_ar, job.title_en)}</h1>
      {job.is_demo && <p className="mt-5 border-s-2 border-gold ps-4 text-sm font-medium">{t('demoNote')}</p>}
      <h2 className="mt-10 font-display text-xl font-semibold">{t('about')}</h2>
      <p className="mt-2 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-muted">{description || t('noDescription')}</p>
      {pick(locale, job.requirements_ar ?? '', job.requirements_en ?? '') && (
        <>
          <h2 className="mt-8 font-display text-xl font-semibold">{t('requirements')}</h2>
          <p className="mt-2 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-muted">{pick(locale, job.requirements_ar ?? '', job.requirements_en ?? '')}</p>
        </>
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
      <div className="mt-10">
        {applied ? (
          <p role="status" className="font-semibold text-primary">
            {t('applied')}. <Link href="/dashboard" className="underline underline-offset-4">{t('viewApplications')}</Link>
          </p>
        ) : session?.accountType === 'organization' ? (
          <p className="text-muted">{t('orgCannotApply')}</p>
        ) : session ? (
          <ApplyButton jobId={id} />
        ) : (
          <Link href="/login" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">
            {t('signInToApply')}<Arrow />
          </Link>
        )}
      </div>
    </article>
  );
}
