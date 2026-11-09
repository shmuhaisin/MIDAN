import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { RegisterForm } from '@/components/forms';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getSession()) redirect({ href: '/dashboard', locale });
  const t = await getTranslations({ locale, namespace: 'auth' });
  const audience = (await searchParams).as === 'organization' ? 'organization' : 'candidate';
  const org = audience === 'organization';
  return (
    <AuthShell audience={audience} title={t(org ? 'orgRegisterTitle' : 'registerTitle')} lead={t(org ? 'orgRegisterLead' : 'registerLead')}>
      {process.env.DEV_TEST_SIGNUP === 'true' ? (
        <>
          <aside className="callout mb-6 text-sm">
            <p className="font-semibold">{t('devTitle')}</p>
            <p className="mt-1 leading-relaxed">{t('devBody')}</p>
          </aside>
          <RegisterForm audience={audience} />
        </>
      ) : (
        <div>
          <h2 className="subsection-title">{t('closedTitle')}</h2>
          <p className="mt-2 mb-6 text-muted">{t('closedBody')}</p>
          <Link href={audience === 'organization' ? '/login?as=organization' : '/login'} className="btn btn-primary btn-lg">{t('loginSubmit')}</Link>
        </div>
      )}
    </AuthShell>
  );
}
