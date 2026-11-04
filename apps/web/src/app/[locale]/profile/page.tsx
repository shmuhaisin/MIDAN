import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileForm } from '@/components/forms';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { getSession } from '@/lib/session';

type Me = { display_name: string | null; candidate_profiles: { full_name: string; headline: string | null; city: string | null; share_profile_consent: boolean } | null };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login', locale });
  const me = await apiForPage<Me>('/me');
  const t = await getTranslations({ locale, namespace: 'profile' });
  const initial = me?.candidate_profiles ?? (me?.display_name ? { full_name: me.display_name } : null);
  return (
    <section className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <Link href="/dashboard" className="text-sm font-medium text-muted hover:text-foreground">{t('back')}</Link>
      <h1 className="mt-6 font-display text-4xl font-bold">{t('title')}</h1>
      <p className="mt-2 mb-8 text-lg text-muted">{t('lead')}</p>
      <ProfileForm profile={initial} />
    </section>
  );
}
