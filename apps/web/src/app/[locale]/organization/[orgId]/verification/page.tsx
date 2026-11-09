import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrganizationReview } from '@/components/verification';
import { Masthead } from '@/components/workspace-kit';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { getSession } from '@/lib/session';
import type { VerificationState } from '@/lib/verification';

/**
 * The organization's application for review. Owners and admins complete the profile, add documents and submit; a platform
 * administrator decides. Other members see where it stands. GET /organizations/:orgId/verification is owners and admins only.
 */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await apiForPage<{ my_role: string; name_ar: string; name_en: string; verification_status: VerificationState['organization']['verification_status'] }>(`/organizations/${orgId}`);
  if (!org) notFound();
  const canManage = org.my_role === 'owner' || org.my_role === 'admin';
  const state = canManage ? await apiForPage<VerificationState>(`/organizations/${orgId}/verification`) : null;
  const t = await getTranslations({ locale, namespace: 'verification' });
  return (
    <div className="space-y-8">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={t('title')} lead={t('lead')} />
      {state ? <OrganizationReview orgId={orgId} state={state} canManage={canManage} /> : (
        <section className="card space-y-2">
          <h2 className="subsection-title">{t('statusHeading')}</h2>
          <p>{t(`statusBody.${org.verification_status}`)}</p>
          <p className="text-sm text-muted">{t('ownersOnly')}</p>
        </section>
      )}
    </div>
  );
}
