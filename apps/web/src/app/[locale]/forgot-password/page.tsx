import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { ForgotPasswordForm } from '@/components/forms';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  return (
    <AuthShell audience="candidate" title={t('forgotTitle')} lead={t('forgotLead')}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
