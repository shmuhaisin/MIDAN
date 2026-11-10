import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DetailsStep, IdentityStep, SetupSteps, type SetupIdentity } from '@/components/company-setup';
import { TeamPanel, type TeamInvitation, type TeamMember } from '@/components/organization-team';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { orgAssetUrl, type BrandPalette, type OrgBranding } from '@/lib/org-theme';
import { getSession } from '@/lib/session';

type Org = {
  my_role: string; name_ar: string; name_en: string; company_type: string | null;
  branding: (OrgBranding & { industry: string | null; welcome_ar: string | null; welcome_en: string | null; palette: BrandPalette | null }) | null;
};

/**
 * Company setup after approval: details, then the logo and the identity read from it, then the team. Which step opens
 * comes from what's actually saved, so a representative who leaves and comes back continues where they stopped, and
 * nothing they've already given is asked for again.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ step?: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const [org, team] = await Promise.all([
    apiForPage<Org>(`/organizations/${orgId}`),
    apiForPage<{ members: TeamMember[]; invitations: TeamInvitation[] }>(`/organizations/${orgId}/team`),
  ]);
  if (!org) notFound();
  const t = await getTranslations({ locale, namespace: 'companySetup' });
  const canEdit = ['owner', 'admin'].includes(org.my_role);
  const b = org.branding;
  const current = Boolean(b?.palette && b.palette_logo_path && b.palette_logo_path === b.logo_path);
  const done = [
    Boolean(b?.industry),
    b?.palette_status === 'approved' && current,
    (team?.members.length ?? 0) + (team?.invitations.length ?? 0) > 1,
  ];
  const asked = Number((await searchParams).step);
  const firstOpen = done.findIndex((d) => !d) + 1 || 3;
  const step = asked >= 1 && asked <= 3 ? asked : firstOpen;
  const name = pick(locale, org.name_ar, org.name_en);
  const identity: SetupIdentity = {
    logoUrl: orgAssetUrl(b?.logo_path),
    palette: current ? (b?.palette ?? null) : null,
    status: (b?.palette_status as SetupIdentity['status']) ?? null,
    current,
  };
  const keys = ['details', 'identity', 'team'] as const;

  return (
    <div className="max-w-5xl">
      <p className="label-caps">{t('eyebrow', { org: name })}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="display-lg max-w-3xl text-balance">{t(`step.${keys[step - 1]}.title`)}</h1>
        <p className="num text-sm text-muted">{t('progress', { step, total: 3 })}</p>
      </div>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t(`step.${keys[step - 1]}.lead`)}</p>
      {!canEdit && <p role="note" className="callout mt-6 text-sm">{t('readOnly')}</p>}

      <div className="mt-8"><SetupSteps orgId={orgId} step={step} done={done} /></div>

      <section className="mt-8 rounded-[var(--radius-panel)] border border-border bg-surface p-6 shadow-[var(--shadow)] lg:p-8">
        {step === 1 && (
          <DetailsStep orgId={orgId} canEdit={canEdit} initial={{ industry: b?.industry ?? null, company_type: org.company_type, welcome_ar: b?.welcome_ar ?? null, welcome_en: b?.welcome_en ?? null }} />
        )}
        {step === 2 && (
          <IdentityStep
            orgId={orgId} orgName={name} identity={identity} canEdit={canEdit}
            logoNote={b?.palette && !current ? t('identity.newLogo') : undefined}
          />
        )}
        {step === 3 && (
          <div className="space-y-6">
            <p className="max-w-prose text-sm leading-relaxed text-muted">{t('team.note')}</p>
            {team && <TeamPanel orgId={orgId} members={team.members} invitations={team.invitations} me={session.id} myRole={org.my_role} />}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
              <Link href={`/organization/${orgId}/setup?step=2`} className="btn btn-ghost">{t('back')}</Link>
              <Link href={`/organization/${orgId}?setup=done`} className="btn btn-primary">{t('finish')}</Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
