import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AcceptInvitation } from '@/components/accept-invitation';
import { getInvitationContext } from '@/lib/invitation-context';
import { getSession } from '@/lib/session';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); const t = await getTranslations('members');
  return <section className="mx-auto max-w-xl space-y-6 px-4 py-12"><h1 className="font-display text-3xl font-bold">{t('acceptTitle')}</h1><AcceptInvitation signedIn={Boolean(await getSession())} initialExpiresAt={(await getInvitationContext())?.expiresAt ?? null} /></section>;
}
