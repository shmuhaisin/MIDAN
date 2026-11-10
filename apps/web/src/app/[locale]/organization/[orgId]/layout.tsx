import { getTranslations } from 'next-intl/server';
import { OrgNav } from '@/components/org-shell';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { orgAssetUrl, orgTheme, type OrgBranding } from '@/lib/org-theme';
import { getSession } from '@/lib/session';

type Org = {
  name_ar: string;
  name_en: string;
  my_role: string;
  is_demo?: boolean;
  verification_status?: string;
  branding: OrgBranding | null;
};

/**
 * The employer workspace. One platform, one design system: the organization's own identity (logo, name, two colours) is
 * applied only inside this shell, as CSS variables on its wrapper, so it can never reach another organization's
 * workspace or MIDAN's own pages. The API decides membership; a non-member gets no organization and sees the page's
 * own not-found.
 */
export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  if (!(await getSession()) || !/^[0-9a-f-]{36}$/.test(orgId)) return children;
  const org = await apiForPage<Org>(`/organizations/${orgId}`).catch(() => null);
  if (!org) return children;
  const t = await getTranslations({ locale, namespace: 'orgShell' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const to = await getTranslations({ locale, namespace: 'org' });
  const tv = await getTranslations({ locale, namespace: 'verification' });
  const name = pick(locale, org.name_ar, org.name_en);
  const logo = orgAssetUrl(org.branding?.logo_path);
  // The company's approved identity themes everything inside this wrapper, in light and dark (src/lib/org-theme.ts).
  const theme = orgTheme(org.branding);

  return (
    <div style={theme.style} className={`flex-1 bg-surface-2/40 ${theme.className}`} data-org-workspace={orgId}>
      <div aria-hidden className="h-1.5 bg-[linear-gradient(90deg,var(--org-primary,var(--brand-deep))_0_72%,var(--org-accent,var(--brand-gold))_72%_100%)]" />
      <div className="container-page grid grid-cols-[minmax(0,1fr)] gap-6 py-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-4">
            {logo ? (
              // Organization logos come from Supabase Storage, which the CSP allows; next/image would need a remote pattern.
              <img src={logo} alt="" className="size-12 shrink-0 rounded-[var(--radius-panel)] border border-border bg-surface object-contain p-1.5 lg:size-16" />
            ) : (
              <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-[var(--radius-panel)] bg-[var(--org-primary,var(--brand-deep))] font-display text-xl font-bold text-[var(--org-on-primary,var(--brand-ivory))] lg:size-16 lg:text-2xl">
                {name.trim().charAt(0)}
              </span>
            )}
            <div className="min-w-0">
              <p className="label-caps">{t('workspace')}</p>
              <p className="truncate font-display text-lg leading-snug font-bold lg:whitespace-normal">{name}</p>
              <p className="text-sm text-muted"><span className="sr-only">{to('yourRole', { role: '' })}</span>{td(`role.${org.my_role}`)}</p>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <OrgNav orgId={orgId} />
          </div>
        </aside>
        <div className="min-w-0">
          {org.verification_status && org.verification_status !== 'approved' && (
            // Until a MIDAN administrator approves the organization, publishing, applications and invitations stay closed.
            <div role="status" className={`callout mb-6 flex flex-wrap items-center justify-between gap-3 text-sm ${org.verification_status === 'suspended' || org.verification_status === 'rejected' ? 'border-error' : ''}`}>
              <p className="max-w-3xl">{tv(`banner.${org.verification_status}`)}</p>
              {['owner', 'admin'].includes(org.my_role) && <Link href={`/organization/${orgId}/verification`} className="btn btn-secondary btn-sm">{tv('banner.action')}</Link>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
