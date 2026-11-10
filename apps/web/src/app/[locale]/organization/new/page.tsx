import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmployerAccessRequestForm, type AccessRequest, type SignupChoice } from '@/components/employer-access';
import { OrganizationForm, type SupportedEmployer } from '@/components/forms';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import { getSession } from '@/lib/session';
import { AuthShell } from '@/components/auth-shell';

// An organization account without a workspace: its access request and where it stands. Workspaces are created by a
// MIDAN platform administrator's approval, never here (20261112090000_employer_access_requests). Only the automated test
// and demo accounts may still create a sandbox organization, which the database also enforces.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login?as=organization', locale });
  if (session.accountType === 'candidate') return redirect({ href: '/dashboard', locale });
  const [me, request, choice] = await Promise.all([
    apiForPage<{ organization_members: { org_id: string }[] }>('/me'),
    apiForPage<AccessRequest | null>('/me/employer-access'),
    // No request at all after a verified sign-up means provisioning couldn't open it: offer the sign-up choice again.
    apiForPage<SignupChoice | null>('/me/employer-access/signup-choice'),
  ]);
  const fixture = /^midan\.(test|demo)\..+@example\.com$/.test(session.email ?? '');
  if (me?.organization_members.length && !fixture) return redirect({ href: `/organization/${me.organization_members[0].org_id}`, locale });
  const t = await getTranslations({ locale, namespace: 'employerAccess' });
  const tOrg = await getTranslations({ locale, namespace: 'org' });
  if (fixture) {
    return (
      <AuthShell audience="organization" title={tOrg('newTitle')} lead={tOrg('newLead')}>
        <OrganizationForm />
      </AuthShell>
    );
  }
  const employerName = (r: AccessRequest) => (locale === 'ar' ? r.employer_name_ar : r.employer_name_en) ?? r.employer_name_en ?? r.employer_name_ar ?? '';
  if (request?.status === 'pending_approval') {
    return (
      <AuthShell audience="organization" title={t('pendingTitle')} lead={t('pendingLead')}>
        <div role="status" className="callout space-y-2 text-sm">
          <p><span className="text-muted">{t('employer')}: </span><strong>{employerName(request)}</strong></p>
          <p><span className="text-muted">{t('representative')}: </span><bdi>{request.representative_name}</bdi> · <bdi>{request.job_title}</bdi></p>
          <p><span className="text-muted">{t('submitted')}: </span>{formatWhen(locale, request.created_at, 'Asia/Riyadh')}</p>
          <p className="pt-1">{t('pendingBody')}</p>
        </div>
      </AuthShell>
    );
  }
  let employers: SupportedEmployer[] = [];
  try {
    const response = await fetch(`${process.env.API_URL}/v1/reference/employers`, { cache: 'no-store' });
    if (response.ok) employers = ((await response.json()) as SupportedEmployer[]).map(({ id, name_ar, name_en }) => ({ id, name_ar, name_en }));
  } catch {
    // The form shows no employers to choose from; nothing can be requested.
  }
  return (
    <AuthShell audience="organization" title={t('requestTitle')} lead={t('requestLead')}>
      {request && ['rejected', 'revoked'].includes(request.status) && (
        <div role="alert" className="callout mb-6 text-sm">
          <p className="font-semibold">{t(request.status === 'rejected' ? 'rejectedTitle' : 'revokedTitle', { employer: employerName(request) })}</p>
          {request.decision_note && <p className="mt-1" dir="auto">{request.decision_note}</p>}
        </div>
      )}
      <EmployerAccessRequestForm employers={employers} defaultName={session.displayName ?? ''} choice={request ? null : choice} />
    </AuthShell>
  );
}
