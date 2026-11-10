import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Humaidan } from '@/components/brand';
import { EmployerClaimPanel, TeamPanel, type OrgClaim, type RegistryOption, type TeamInvitation, type TeamMember } from '@/components/organization-team';
import { Masthead } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { resolveHumaidan } from '@/lib/humaidan';
import { orgAssetUrl, type BrandPalette, type OrgBranding } from '@/lib/org-theme';
import { getSession } from '@/lib/session';

type Org = {
  my_role: string; name_ar: string; name_en: string;
  company_type: string | null;
  branding: (OrgBranding & { industry: string | null; welcome_ar: string | null; welcome_en: string | null; palette: BrandPalette | null }) | null;
};

/**
 * The organization's settings: its identity and details as they stand (changed through the same guided steps as the
 * first setup, so there's one way to do it), its team, and its link to an official employer profile.
 */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const [org, team] = await Promise.all([
    apiForPage<Org>(`/organizations/${orgId}`),
    apiForPage<{ members: TeamMember[]; invitations: TeamInvitation[] }>(`/organizations/${orgId}/team`),
  ]);
  if (!org || !team) notFound();
  const canManage = ['owner', 'admin'].includes(org.my_role);
  const [claims, employers] = canManage
    ? await Promise.all([
      apiForPage<{ claims: OrgClaim[]; employer: { name_ar: string; name_en: string; source_company_id: string } | null; is_demo: boolean }>(`/organizations/${orgId}/employer-claims`),
      apiForPage<RegistryOption[]>('/reference/employers'),
    ])
    : [null, null];
  const t = await getTranslations({ locale, namespace: 'orgSettings' });
  const tf = await getTranslations({ locale, namespace: 'fields' });
  const tc = await getTranslations({ locale, namespace: 'assessmentIntel.companyTypes' });
  const b = org.branding;
  const logo = orgAssetUrl(b?.logo_path);
  const current = Boolean(b?.palette && b.palette_logo_path === b.logo_path);
  const approved = b?.palette_status === 'approved' && current;
  const palette = current ? b?.palette : null;
  const welcome = pick(locale, b?.welcome_ar ?? '', b?.welcome_en ?? '');

  return (
    <div className="max-w-5xl space-y-8">
      <Masthead eyebrow={pick(locale, org.name_ar, org.name_en)} title={t('title')} lead={t('lead')} />
      {!canManage && <p role="note" className="callout text-sm">{t('readOnly')}</p>}

      <section aria-labelledby="identity" className="grid gap-8 rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:grid-cols-[minmax(0,1fr)_14rem] lg:p-8">
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="identity" className="section-title">{t('identityTitle')}</h2>
              <p className="mt-1 max-w-prose text-sm text-muted">{t('identityLead')}</p>
            </div>
            {canManage && <Link href={`/organization/${orgId}/setup?step=2`} className="btn btn-secondary btn-sm">{logo ? t('changeIdentity') : t('addLogo')}</Link>}
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="grid h-20 w-36 place-items-center rounded-[var(--radius-control)] border border-border bg-background p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- the organization's own upload, from Storage */}
              {logo ? <img src={logo} alt={t('logoAlt')} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">{t('noLogo')}</span>}
            </div>
            <div className="min-w-0 space-y-2">
              {palette ? (
                <>
                  <ul className="flex gap-2" aria-label={t('colours')}>
                    {[palette.primary, palette.secondary, palette.accent].filter((h, i, all): h is string => Boolean(h) && all.indexOf(h) === i).map((hex) => (
                      <li key={hex} className="flex items-center gap-2 text-xs"><span aria-hidden className="size-6 rounded-full border border-black/10" style={{ background: hex }} /><span className="num text-muted">{hex}</span></li>
                    ))}
                  </ul>
                  <p className={clsx('text-sm font-semibold', approved ? 'text-success' : 'text-warning')}>{approved ? t('identityApproved') : t('identitySuggested')}</p>
                </>
              ) : <p className="text-sm text-muted">{logo ? t('identityNotRead') : t('identityNone')}</p>}
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h3 className="subsection-title">{t('detailsTitle')}</h3>
              {canManage && <Link href={`/organization/${orgId}/setup?step=1`} className="btn btn-secondary btn-sm">{t('editDetails')}</Link>}
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">{t('field')}</dt><dd className="mt-1 font-semibold">{b?.industry ? tf(b.industry) : t('notSet')}</dd></div>
              <div><dt className="text-muted">{t('companyType')}</dt><dd className="mt-1 font-semibold">{org.company_type ? tc(org.company_type) : t('notSet')}</dd></div>
              <div className="sm:col-span-3"><dt className="text-muted">{t('welcome')}</dt><dd className="mt-1" dir="auto">{welcome || <span className="text-muted">{t('notSet')}</span>}</dd></div>
            </dl>
          </div>
        </div>
        <aside className="rounded-[var(--radius-panel)] bg-surface-2/60 p-4 lg:self-start">
          <p className="text-sm font-semibold">{t('humaidanTitle')}</p>
          <div className="mx-auto mt-3 w-32"><Humaidan outfit={resolveHumaidan(null, b?.industry ?? '')} sizes="128px" /></div>
          <p className="mt-3 text-xs text-muted">{t('humaidanNote')}</p>
        </aside>
      </section>

      <div id="team"><TeamPanel orgId={orgId} members={team.members} invitations={team.invitations} me={session.id} myRole={org.my_role} /></div>
      {claims && <EmployerClaimPanel orgId={orgId} claims={claims.claims} employer={claims.employer} isDemo={claims.is_demo} options={employers ?? []} />}
    </div>
  );
}
