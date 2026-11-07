import { setRequestLocale } from 'next-intl/server';
import { AuthConfirmation } from '@/components/auth-confirmation';
import { getInvitationContext } from '@/lib/invitation-context';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale);
  return <AuthConfirmation invitationContext={Boolean(await getInvitationContext())} />;
}
