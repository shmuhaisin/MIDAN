import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Humaidan, Logo } from '@/components/brand';
import { CvAnalysisStatus, OnboardingBasics, OnboardingStepButton, ReferenceSkillPicker } from '@/components/candidate';
import { CvPanel } from '@/components/profile';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { number } from '@/lib/format';

type Me = {
  display_name: string | null;
  candidate_profiles: { full_name: string; phone: string | null; city: string | null; headline: string | null; cv_path: string | null; onboarding_step: number; onboarding_completed_at: string | null } | null;
};
type Picked = { reference_skills: { id: string; name_ar: string; sector_code: string } }[];

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ step?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  const [me, analysis, picked] = await Promise.all([apiForPage<Me>('/me'), apiForPage<CvAnalysis | null>('/me/cv/analyses/latest'), apiForPage<Picked>('/me/reference-skills')]);
  const profile = me?.candidate_profiles ?? null;
  // Picks up where they stopped.
  const asked = Number((await searchParams).step);
  const step = asked >= 1 && asked <= 4 ? asked : Math.min((profile?.onboarding_step ?? 0) + 1, 4);
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <Logo className="h-14" sizes="110px" priority />
        <p className="text-sm font-medium text-muted">{t('progress', { step: number(locale, step), total: number(locale, 4) })}</p>
      </div>
      <div aria-hidden className="mt-4 flex gap-1">{[1, 2, 3, 4].map((n) => <span key={n} className={n <= step ? 'h-1.5 flex-1 rounded-full bg-primary' : 'h-1.5 flex-1 rounded-full bg-surface-2'} />)}</div>
      <h1 className="mt-8 font-display text-3xl font-bold sm:text-4xl">{t(`step${step}Title`)}</h1>
      <p className="mt-2 mb-8 text-lg text-muted">{t(`step${step}Lead`)}</p>
      {step === 1 && <OnboardingBasics profile={profile} fallbackName={me?.display_name ?? ''} />}
      {step === 2 && (
        <div className="space-y-4">
          <p className="rounded-lg bg-surface p-4 text-sm">{t('privacy')}</p>
          <CvPanel hasCv={Boolean(profile?.cv_path)} hasProfile={Boolean(profile)} />
          <CvAnalysisStatus analysis={analysis} />
          <div className="flex items-center gap-4">
            <OnboardingStepButton step={2} href="/onboarding?step=3" label={t('next')} />
            <Link href="/onboarding?step=1" className="font-semibold">{t('back')}</Link>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-6">
          <ReferenceSkillPicker selected={(picked ?? []).map((p) => p.reference_skills)} />
          <div className="flex items-center gap-4">
            <OnboardingStepButton step={3} href="/onboarding?step=4" label={t('next')} />
            <Link href="/onboarding?step=2" className="font-semibold">{t('back')}</Link>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="space-y-6">
          <div className="w-32"><Humaidan sizes="128px" /></div>
          <OnboardingStepButton step={4} finish href="/opportunities" label={t('browse')} />
          <Link href="/profile" className="font-semibold text-primary underline underline-offset-4">{t('completeProfile')}</Link>
        </div>
      )}
    </section>
  );
}
