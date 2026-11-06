import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrganizationForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { getSession } from '@/lib/session';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login?as=organization', locale });
  if (session.accountType === 'candidate') return redirect({ href: '/dashboard', locale });
  let existing: string | undefined;
  try {
    const me = await api<{ organization_members: { org_id: string }[] }>('/me');
    existing = me.organization_members[0]?.org_id;
  } catch {
    // Provisioning can fail while sign-in still works. The form below is the existing way to finish.
  }
  if (existing) return redirect({ href: `/organization/${existing}`, locale });
  const t = await getTranslations({ locale, namespace: 'org' });
  return (
    <section className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold">{t('newTitle')}</h1>
      <p className="mt-2 mb-8 text-lg text-muted">{t('newLead')}</p>
      <OrganizationForm />
    </section>
  );
}
