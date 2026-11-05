import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CvPanel, ProfileForm, type ProfileData } from '@/components/profile';
import { Link, redirect } from '@/i18n/navigation';
import { api, apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

type Me = { display_name: string | null; candidate_profiles: ProfileData; candidate_skills: { skill_id: string }[] };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  const [me, skills] = await Promise.all([
    apiForPage<Me>('/me'),
    api<{ id: string; name_ar: string; name_en: string }[]>('/skills'),
  ]);
  const t = await getTranslations({ locale, namespace: 'profile' });
  const profile = me?.candidate_profiles ?? null;
  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>
      <h1 className="mt-5 font-display text-4xl font-bold">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">{t('lead')}</p>
      <p className="mt-4 mb-8 border-s-2 border-gold ps-4 text-sm font-medium">{t('demoWarning')}</p>
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-start">
        <ProfileForm profile={profile} skills={skills} selected={me?.candidate_skills.map((s) => s.skill_id) ?? []} fallbackName={me?.display_name ?? ''} />
        <div className="lg:sticky lg:top-24"><CvPanel hasCv={Boolean(profile?.cv_path)} hasProfile={Boolean(profile)} /></div>
      </div>
    </section>
  );
}
