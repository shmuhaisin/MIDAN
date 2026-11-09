import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CvPanel, ProfileForm, type ProfileData } from '@/components/profile';
import { SkillsEditor, type SkillSuggestion } from '@/components/candidate';
import { Link, redirect } from '@/i18n/navigation';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';
import { Section } from '@/components/ui';
import { Masthead } from '@/components/workspace-kit';

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
  const tc = await getTranslations({ locale, namespace: 'candidateNav' });
  const profile = me?.candidate_profiles ?? null;
  return (
    <>
    <section className="container-page py-8 lg:py-10">
      <Masthead eyebrow={tc('profile')} title={t('title')} lead={t('lead')} />
      <p className="callout mt-6 mb-10 text-sm">{t('demoWarning')}</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-12">
        <div className="min-w-0 space-y-12">
          <ProfileForm profile={profile} selected={me?.candidate_skills.map((s) => s.skill_id) ?? []} fallbackName={me?.display_name ?? ''} />
          {profile && (
            <Section id="reference-skills" title={t('skills')} lead={t('skillsLead')}>
              <SkillsEditor selected={(picked ?? []).map((p) => p.reference_skills)} own={profile.self_reported_skills ?? []} suggestions={suggestions ?? []} />
            </Section>
          )}
        </div>
        <div className="lg:sticky lg:top-28"><CvPanel hasCv={Boolean(profile?.cv_path)} hasProfile={Boolean(profile)} analysis={analysis} /></div>
      </div>
    </section>
    </>
  );
}
