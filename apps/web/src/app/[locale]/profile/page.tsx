import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CvPanel, ProfileForm, type ProfileData } from '@/components/profile';
import { ReferenceSkillPicker } from '@/components/candidate';
import { CandidateNav } from '@/components/candidate-nav';
import { Link, redirect } from '@/i18n/navigation';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { api, apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

type Me = { display_name: string | null; candidate_profiles: ProfileData; candidate_skills: { skill_id: string }[] };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  const [me, skills, analysis, picked] = await Promise.all([
    apiForPage<Me>('/me'),
    api<{ id: string; name_ar: string; name_en: string }[]>('/skills'),
    apiForPage<CvAnalysis | null>('/me/cv/analyses/latest'),
    apiForPage<{ reference_skills: { id: string; name_ar: string; sector_code: string } }[]>('/me/reference-skills'),
  ]);
  const t = await getTranslations({ locale, namespace: 'profile' });
  const profile = me?.candidate_profiles ?? null;
  return (
    <>
    <CandidateNav current="profile" />
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>
      <h1 className="mt-5 font-display text-4xl font-bold">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">{t('lead')}</p>
      <p className="mt-4 mb-8 border-s-2 border-gold ps-4 text-sm font-medium">{t('demoWarning')}</p>
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-start">
        <ProfileForm profile={profile} skills={skills} selected={me?.candidate_skills.map((s) => s.skill_id) ?? []} fallbackName={me?.display_name ?? ''} />
        <div className="lg:sticky lg:top-24"><CvPanel hasCv={Boolean(profile?.cv_path)} hasProfile={Boolean(profile)} analysis={analysis} /></div>
      </div>
      {profile && (
        <section aria-labelledby="reference-skills" className="mt-12 max-w-3xl">
          <h2 id="reference-skills" className="mb-2 font-display text-xl font-semibold">{t('referenceSkills')}</h2>
          <ReferenceSkillPicker selected={(picked ?? []).map((p) => p.reference_skills)} />
        </section>
      )}
    </section>
    </>
  );
}
