import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsForm } from '@/components/candidate';
import { ChangePasswordForm } from '@/components/forms';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Masthead } from '@/components/workspace-kit';

type Me = { email: string; candidate_profiles: { full_name: string; time_zone: string; notification_prefs: { deadline_reminders?: boolean } } | null };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await apiForPage<Me>('/me');
  const t = await getTranslations({ locale, namespace: 'settings' });
  const tc = await getTranslations({ locale, namespace: 'candidateNav' });
  const profile = me?.candidate_profiles;
  return (
    <>
      <div className="container-page py-8 lg:py-10">
        <Masthead eyebrow={tc('settings')} title={t('title')} />
        <div className="mt-10 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
          <nav aria-label={t('title')} className="lg:sticky lg:top-28 lg:self-start">
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {[['account', t('account'), 'user'], ['preferences', t('preferences'), 'settings'], ['privacy', t('privacy'), 'shield']].map(([id, label, icon]) => (
                <li key={id} className="shrink-0"><a href={`#${id}`} className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"><Icon name={icon as 'user'} className="size-4" />{label}</a></li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 max-w-3xl space-y-6">
            <section aria-labelledby="account" className="panel">
              <h2 id="account" className="panel-head section-title">{t('account')}</h2>
              <div className="panel-body">
                <p><span className="text-sm text-muted">{t('email')}: </span><span className="font-medium" dir="ltr">{me?.email}</span></p>
                <div className="mt-5 max-w-sm"><ChangePasswordForm /></div>
              </div>
            </section>
            <section aria-labelledby="preferences" className="panel">
              <h2 id="preferences" className="panel-head section-title">{t('preferences')}</h2>
              <div className="panel-body">
                {profile
                  ? <SettingsForm fullName={profile.full_name} timeZone={profile.time_zone} reminders={profile.notification_prefs?.deadline_reminders !== false} />
                  : <Link href="/onboarding" className="link">{t('completeProfile')}</Link>}
              </div>
            </section>
            <section aria-labelledby="privacy" className="panel">
              <h2 id="privacy" className="panel-head section-title">{t('privacy')}</h2>
              <div className="panel-body">
                <ul className="space-y-3 leading-relaxed">
                  {(t.raw('privacyPoints') as string[]).map((p) => <li key={p} className="flex gap-3"><Icon name="shield" className="mt-0.5 size-4 shrink-0 text-primary" />{p}</li>)}
                </ul>
                <Link href="/profile" className="link mt-4 inline-block">{t('manageData')}</Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
