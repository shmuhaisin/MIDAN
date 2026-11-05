import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { googleSignInEnabled } from '@/lib/auth-actions';
import { safeNext } from '@/lib/next-path';
import { getSession } from '@/lib/session';

const SHOWN_ERRORS = new Set(['google_failed', 'registration_closed', 'unavailable']);

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string; next?: string; error?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getSession()) redirect({ href: next ?? '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'auth' });
  const audience = query.as === 'organization' ? 'organization' : 'candidate';
  const org = audience === 'organization';
  return (
    <AuthShell audience={audience} title={t(org ? 'orgLoginTitle' : 'loginTitle')} lead={t(org ? 'orgLoginLead' : 'loginLead')}>
      <LoginForm audience={audience} next={next} google={await googleSignInEnabled()} errorCode={query.error && SHOWN_ERRORS.has(query.error) ? query.error : undefined} />
    </AuthShell>
  );
}
