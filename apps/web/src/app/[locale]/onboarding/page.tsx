import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Humaidan } from '@/components/brand';
import { CvAnalysisStatus, OnboardingBasics, OnboardingStepButton, SkillsEditor, type SkillSuggestion } from '@/components/candidate';
import { Guide } from '@/components/guide';
import { Icon } from '@/components/icons';
import { OnboardingList } from '@/components/onboarding';
import { CvPanel } from '@/components/profile';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import type { CvAnalysis } from '@/lib/candidate-actions';
import { number } from '@/lib/format';

type Item = Record<string, string | number | null>;
type Me = {
  display_name: string | null;
  candidate_profiles: {
    self_reported_skills: string[]; full_name: string; phone: string | null; city: string | null; headline: string | null; cv_path: string | null;
    onboarding_step: number; onboarding_completed_at: string | null; education?: Item[]; experience?: Item[];
  } | null;
};
type Picked = { reference_skills: { id: string; name_ar: string; sector_code: string } }[];

const STEPS = 6;

/**
 * Building a profile as a guided conversation: a quiet progress line across the top, one step at a time with its fields
 * grouped, Humaidan beside it saying why each step matters, and Back / Continue always within reach.
 * Each step saves as you continue, so leaving and coming back resumes where you stopped.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ step?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  const tp = await getTranslations({ locale, namespace: 'profile' });
  const [me, analysis, picked, suggestions] = await Promise.all([apiForPage<Me>('/me'), apiForPage<CvAnalysis | null>('/me/cv/analyses/latest'), apiForPage<Picked>('/me/reference-skills'), apiForPage<SkillSuggestion[]>('/me/skill-suggestions')]);
  const profile = me?.candidate_profiles ?? null;
  const asked = Number((await searchParams).step);
  const step = asked >= 1 && asked <= STEPS ? asked : Math.min((profile?.onboarding_step ?? 0) + 1, STEPS);
  // Nothing past step one works without a profile: it's created with the name.
  const current = profile ? step : 1;
  const saved = profile?.onboarding_step ?? 0;
  const reachable = Math.max(saved + 1, current);
  const names = Array.from({ length: STEPS }, (_, i) => t(`stepName${i + 1}`));
  const fullName = profile?.full_name ?? me?.display_name ?? '';
  const n = (v: number) => number(locale, v);
  const back = current > 1 ? <Link href={`/onboarding?step=${current - 1}`} className="btn btn-ghost"><Icon name="chevron" className="size-4 rotate-180" />{t('back')}</Link> : null;

  const review = profile ? [
    { step: 1, label: tp('fullName'), parts: [profile.full_name, profile.headline, profile.city, profile.phone] },
    { step: 2, label: t('stepName2'), parts: [profile.cv_path ? t('cvYes') : null] },
    { step: 3, label: t('stepName3'), parts: (profile.education ?? []).map((e) => e.qualification) },
    { step: 4, label: t('stepName4'), parts: (profile.experience ?? []).map((e) => e.title) },
    { step: 5, label: t('stepName5'), parts: [...(picked ?? []).map((p) => p.reference_skills.name_ar), ...(profile.self_reported_skills ?? [])] },
  ].map((r) => ({ ...r, value: r.parts.filter(Boolean).map(String) })) : [];
  const reviewDone = review.filter((r) => r.value.length).length;

  return (
    // overflow-x-clip: each step slides in from 24px aside (.step-enter); on a phone that briefly overhangs the gutter, and
    // the page mustn't scroll sideways while it settles. Clip doesn't create a scroll container, so sticky parts still work.
    <section className="container-page min-h-[calc(100vh-9rem)] overflow-x-clip py-8 lg:py-12">
      <div className="mx-auto max-w-[70rem]">
      {/* Progress: six segments, the current one in gold, finished ones in green and clickable. */}
      <nav aria-label={t('stepsLabel')}>
        <div className="flex items-baseline justify-between gap-4">
          <p className="label-caps">{t('buildProfile')}</p>
          <p className="num text-sm text-muted">{t('progress', { step: n(current), total: n(STEPS) })}</p>
        </div>
        <ol className="mt-3 grid grid-cols-6 gap-1.5 sm:gap-2">
          {names.map((name, i) => {
            const state = i + 1 === current ? 'current' : i + 1 <= saved ? 'done' : 'next';
            const body = (
              <>
                <span aria-hidden className={clsx('block h-1.5 rounded-full transition-colors', state === 'done' ? 'bg-primary' : state === 'current' ? 'bg-gold' : 'bg-surface-2')} />
                <span className={clsx('mt-2.5 hidden items-center gap-1.5 text-sm sm:flex', state === 'current' ? 'font-semibold' : state === 'done' ? 'text-foreground/80' : 'text-muted')}>
                  {state === 'done' ? <Icon name="check" className="size-3.5 shrink-0 text-primary" /> : <span className="num text-xs">{n(i + 1)}</span>}
                  <span className="truncate">{name}</span>
                </span>
                <span className="sr-only">{t(`stepState.${state}`)}</span>
              </>
            );
            return (
              <li key={name} aria-current={state === 'current' ? 'step' : undefined}>
                {i + 1 !== current && i + 1 <= reachable && profile
                  ? <Link href={`/onboarding?step=${i + 1}`} className="block rounded-[var(--radius-control)] hover:opacity-80">{body}</Link>
                  : <span className="block">{body}</span>}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-10 grid gap-12 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_18rem] xl:gap-20">
        <div key={current} className="step-enter ob-sheet min-w-0">
          <p className="text-sm font-semibold text-gold-text">{names[current - 1]}</p>
          <h1 className="display-lg mt-2 text-balance">{t(`step${current}Title`)}</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted">{t(`step${current}Lead`)}</p>
          <Guide className="mt-6 lg:hidden" title={current < STEPS ? t('whyTitle') : t('readyTitle')}>{current < STEPS ? t(`why${current}`) : t('readyBody')}</Guide>

          <div className="mt-8">
            {current === 1 && <OnboardingBasics profile={profile} fallbackName={me?.display_name ?? ''} />}

            {current === 2 && (
              <div className="space-y-5">
                <CvPanel hasCv={Boolean(profile?.cv_path)} hasProfile={Boolean(profile)} />
                <CvAnalysisStatus analysis={analysis} />
                <p className="flex gap-3 text-sm leading-relaxed text-muted"><Icon name="shield" className="mt-0.5 size-4 shrink-0 text-primary" />{t('privacy')}</p>
                <div className="ob-actions">
                  {back}
                  <span className="flex-1" />
                  <OnboardingStepButton step={2} href="/onboarding?step=3" label={profile?.cv_path ? t('next') : t('continueWithoutCv')} />
                </div>
              </div>
            )}

            {current === 3 && <OnboardingList kind="education" fullName={fullName} initial={profile?.education ?? []} step={3} next="/onboarding?step=4" back={back} />}
            {current === 4 && <OnboardingList kind="experience" fullName={fullName} initial={profile?.experience ?? []} step={4} next="/onboarding?step=5" back={back} />}

            {current === 5 && (
              <div className="space-y-6">
                <SkillsEditor selected={(picked ?? []).map((p) => p.reference_skills)} own={profile?.self_reported_skills ?? []} suggestions={suggestions ?? []} />
                <div className="ob-actions">
                  {back}
                  <span className="flex-1" />
                  <OnboardingStepButton step={5} href="/onboarding?step=6" label={t('next')} />
                </div>
              </div>
            )}

            {current === 6 && profile && (
              <div className="space-y-6">
                <div className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-border bg-[linear-gradient(135deg,var(--surface),color-mix(in_srgb,var(--brand-mint)_28%,var(--surface)))] p-5">
                  <span aria-hidden className="rise grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Icon name="check" className="size-6" /></span>
                  <div>
                    <p className="font-display text-lg font-bold">{t('reviewSummary', { done: n(reviewDone), total: n(review.length) })}</p>
                    <p className="text-sm text-muted">{t('reviewHint')}</p>
                  </div>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {review.map((r) => (
                    <li key={r.step} className={clsx('relative rounded-[var(--radius-panel)] border p-4', r.value.length ? 'border-border bg-surface' : 'border-dashed border-border-strong')}>
                      <p className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 font-semibold">
                          {r.value.length ? <Icon name="check" className="size-4 text-primary" /> : <span aria-hidden className="size-4 rounded-full border-2 border-border-strong" />}
                          {r.label}
                        </span>
                        <Link href={`/onboarding?step=${r.step}`} className="link text-sm">{r.value.length ? t('edit') : t('add')}</Link>
                      </p>
                      <p className={clsx('mt-2 line-clamp-2 text-sm', r.value.length ? '' : 'text-muted')}>{r.value.length ? r.value.map((v, i) => <span key={i}>{i > 0 && ' · '}<bdi>{v}</bdi></span>) : t('notAdded')}</p>
                    </li>
                  ))}
                </ul>
                <div className="ob-actions">
                  {back}
                  <span className="flex-1" />
                  <OnboardingStepButton step={6} finish href="/dashboard" label={t('finish')} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Humaidan beside the step: why it's asked, in one or two sentences. */}
        <aside aria-label={t('whyTitle')} className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
          <div key={current} className="step-enter relative rounded-[var(--radius-panel)] border border-border bg-surface p-5 shadow-[0_18px_40px_-30px_rgb(11_61_46/0.5)]">
            <p className="label-caps">{current < STEPS ? t('whyTitle') : t('readyTitle')}</p>
            <p className="mt-2 leading-relaxed">{current < STEPS ? t(`why${current}`) : t('readyBody')}</p>
            <span aria-hidden className="absolute -bottom-2 start-1/2 size-4 -translate-x-1/2 rotate-45 border-e border-b border-border bg-surface rtl:translate-x-1/2" />
          </div>
          <div aria-hidden className="mx-auto mt-4 w-40"><Humaidan sizes="160px" idle /></div>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-muted"><Icon name="check" className="size-3.5 text-primary" />{t('savedNote')}</p>
        </aside>
      </div>
      </div>
    </section>
  );
}
