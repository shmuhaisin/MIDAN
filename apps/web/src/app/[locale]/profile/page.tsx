import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CvPanel, ProfileForm, type ProfileData } from '@/components/profile';
import { SkillsEditor, type SkillSuggestion } from '@/components/candidate';
import { Link, redirect } from '@/i18n/navigation';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

type Me = { display_name: string | null; candidate_profiles: ProfileData; candidate_skills: { skill_id: string }[] };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  const [me, suggestions, analysis, picked] = await Promise.all([
    apiForPage<Me>('/me'),
    apiForPage<SkillSuggestion[]>('/me/skill-suggestions'),
    apiForPage<CvAnalysis | null>('/me/cv/analyses/latest'),
    apiForPage<{ reference_skills: { id: string; name_ar: string; sector_code: string } }[]>('/me/reference-skills'),
  ]);
  const t = await getTranslations({ locale, namespace: 'profile' });
  const profile = me?.candidate_profiles ?? null;
  return (
    <>
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="page-title">{t('title')}</h1>
      <p className="mt-1.5 max-w-2xl text-muted">{t('lead')}</p>
      <p className="mt-3 mb-6 text-sm text-muted">{t('demoWarning')}</p>
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-start">
        <ProfileForm profile={profile} selected={me?.candidate_skills.map((s) => s.skill_id) ?? []} fallbackName={me?.display_name ?? ''} />
        <div className="lg:sticky lg:top-24"><CvPanel hasCv={Boolean(profile?.cv_path)} hasProfile={Boolean(profile)} analysis={analysis} /></div>
      </div>
      {profile && (
        <section aria-labelledby="reference-skills" className="mt-10 max-w-3xl">
          <h2 id="reference-skills" className="section-title">{t('skills')}</h2>
          <p className="mb-3 text-sm text-muted">{t('skillsLead')}</p>
          <SkillsEditor selected={(picked ?? []).map((p) => p.reference_skills)} own={profile.self_reported_skills ?? []} suggestions={suggestions ?? []} />
        </section>
      )}
    </section>
    </>
  );
}
