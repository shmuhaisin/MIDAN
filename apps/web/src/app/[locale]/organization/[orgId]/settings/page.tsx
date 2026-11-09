import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CompanyTypeForm } from '@/components/assessment-intel';
import { BrandingForm } from '@/components/forms';
import { EmployerClaimPanel, TeamPanel, type OrgClaim, type RegistryOption, type TeamInvitation, type TeamMember } from '@/components/organization-team';
import { Masthead } from '@/components/workspace-kit';
import { redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Org = {
  my_role: string; name_ar: string; name_en: string;
  company_type: string | null;
  branding: { logo_path: string | null; industry: string | null; primary_color: string | null; accent_color: string | null; welcome_ar: string | null; welcome_en: string | null } | null;
};

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const session = await getSession();
  const [org, team] = await Promise.all([
    apiForPage<Org>(`/organizations/${orgId}`),
    apiForPage<{ members: TeamMember[]; invitations: TeamInvitation[] }>(`/organizations/${orgId}/team`),
  ]);
  if (!org || !team) notFound();
  const canManageTeam = ['owner', 'admin'].includes(org.my_role);
  const [claims, employers] = canManageTeam
    ? await Promise.all([
      apiForPage<{ claims: OrgClaim[]; employer: { name_ar: string; name_en: string; source_company_id: string } | null; is_demo: boolean }>(`/organizations/${orgId}/employer-claims`),
      apiForPage<RegistryOption[]>('/reference/employers'),
    ])
    : [null, null];
  const t = await getTranslations({ locale, namespace: 'branding' });
  const logo = org.branding?.logo_path;
  return (
    <div className="max-w-5xl space-y-8">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={t('title')} lead={t('lead')} />
      <section className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8">
        <BrandingForm
          orgId={orgId}
          branding={org.branding}
          canEdit={['owner', 'admin'].includes(org.my_role)}
          logoUrl={logo ? `${process.env.SUPABASE_URL}/storage/v1/object/public/organization-assets/${logo}` : null}
        />
      </section>
      <section className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8 [&>*:first-child]:mt-0">
        <CompanyTypeForm orgId={orgId} value={org.company_type} canEdit={['owner', 'admin'].includes(org.my_role)} />
      </section>
      <TeamPanel orgId={orgId} members={team.members} invitations={team.invitations} me={session?.id ?? ''} myRole={org.my_role} />
      {claims && <EmployerClaimPanel orgId={orgId} claims={claims.claims} employer={claims.employer} isDemo={claims.is_demo} options={employers ?? []} />}
    </div>
  );
}
