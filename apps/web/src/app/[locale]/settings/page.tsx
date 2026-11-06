import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsForm } from '@/components/candidate';
import { CandidateNav } from '@/components/candidate-nav';
import { ChangePasswordForm } from '@/components/forms';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';

type Me = { email: string; candidate_profiles: { full_name: string; time_zone: string; notification_prefs: { deadline_reminders?: boolean } } | null };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await apiForPage<Me>('/me');
  const t = await getTranslations({ locale, namespace: 'settings' });
  const profile = me?.candidate_profiles;
  return (
    <>
      <CandidateNav current="settings" />
      <div className="mx-auto max-w-3xl space-y-12 px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-bold">{t('title')}</h1>
        <section aria-labelledby="account">
          <h2 id="account" className="font-display text-2xl font-bold">{t('account')}</h2>
          <p className="mt-2"><span className="text-sm text-muted">{t('email')}: </span><span className="font-medium" dir="ltr">{me?.email}</span></p>
          <div className="mt-4 max-w-sm"><ChangePasswordForm /></div>
        </section>
        {profile ? (
          <section aria-labelledby="preferences">
            <h2 id="preferences" className="mb-3 font-display text-2xl font-bold">{t('preferences')}</h2>
            <SettingsForm fullName={profile.full_name} timeZone={profile.time_zone} reminders={profile.notification_prefs?.deadline_reminders !== false} />
          </section>
        ) : <Link href="/onboarding" className="font-semibold text-primary underline underline-offset-4">{t('completeProfile')}</Link>}
        <section aria-labelledby="privacy">
          <h2 id="privacy" className="font-display text-2xl font-bold">{t('privacy')}</h2>
          <ul className="mt-3 list-disc space-y-2 ps-5 leading-relaxed">
            {(t.raw('privacyPoints') as string[]).map((p) => <li key={p}>{p}</li>)}
          </ul>
          <Link href="/profile" className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">{t('manageData')}</Link>
        </section>
      </div>
    </>
  );
}
