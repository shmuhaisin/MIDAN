import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminDocumentList, AdminOrganizationActions, ReviewHistory, ReviewStatusBadge } from '@/components/verification';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import type { VerificationState } from '@/lib/verification';
import { requirePlatformAdmin } from '@/lib/platform-admin';

type Detail = VerificationState & {
  members: { user_id: string; role: string; email: string; display_name: string | null; created_at: string }[];
  jobs: { status: string; count: number }[];
  audit: { id: string; action: string; details: { from?: string; to?: string; reason?: string | null }; created_at: string; actor_email: string | null }[];
};

/** One organization for a platform administrator: what it submitted, its documents, the decision controls and the trail. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  await requirePlatformAdmin();
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await apiForPage<Detail>(`/admin/organizations/${id}`);
  if (!detail) notFound();
  const t = await getTranslations({ locale, namespace: 'admin.organizations' });
  const tv = await getTranslations({ locale, namespace: 'verification' });
  const tc = await getTranslations({ locale, namespace: 'assessmentIntel.companyTypes' });
  const tf = await getTranslations({ locale, namespace: 'fields' });
  const tr = await getTranslations({ locale, namespace: 'admin.accounts.orgRoles' });
  const o = detail.organization;
  const rows: [string, React.ReactNode, boolean?][] = [
    ['name_ar', o.name_ar], ['name_en', o.name_en, true], ['commercial_registration', o.commercial_registration, true],
    ['company_type', o.company_type && tc(o.company_type)], ['industry', o.industry && tf(o.industry)], ['city', o.city],
    ['business_email', o.business_email, true], ['contact_phone', o.contact_phone, true],
    ['website', o.website && <a href={o.website} rel="noopener noreferrer nofollow" target="_blank" className="link">{o.website}</a>, true],
    ['representative_name', o.representative_name], ['representative_title', o.representative_title],
  ];
  return (
    <div className="space-y-6">
      <Link href="/admin/organizations" className="link text-sm">{t('back')}</Link>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-strong pb-5">
        <div className="min-w-0">
          <p className="label-caps" dir="ltr">{o.slug}</p>
          <h1 className="mt-1 font-display text-2xl font-bold sm:text-3xl">{locale === 'ar' ? o.name_ar : o.name_en}</h1>
          <p className="mt-1 text-sm text-muted">{t('createdAt', { when: formatWhen(locale, o.created_at, 'Asia/Riyadh') })}{o.is_test ? ` · ${t('test')}` : ''}</p>
        </div>
        <ReviewStatusBadge status={o.verification_status} />
      </header>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="submitted" className="card space-y-4">
            <h2 id="submitted" className="subsection-title">{t('profile')}</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {rows.map(([key, value, ltr]) => (
                <div key={key}>
                  <dt className="text-xs text-muted">{tv(`field.${key}`)}</dt>
                  <dd dir={ltr ? 'ltr' : 'auto'} className="mt-0.5 break-words">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {(o.description_ar || o.description_en) && (
              <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
                {o.description_ar && <p dir="rtl" className="whitespace-pre-line text-sm">{o.description_ar}</p>}
                {o.description_en && <p dir="ltr" className="whitespace-pre-line text-sm">{o.description_en}</p>}
              </div>
            )}
          </section>
          <section aria-labelledby="docs" className="card space-y-3">
            <h2 id="docs" className="subsection-title">{tv('documentsHeading')}</h2>
            <p className="text-sm text-muted">{t('documentsLead')}</p>
            <AdminDocumentList id={id} documents={detail.documents} />
          </section>
          <section aria-labelledby="members" className="card space-y-3">
            <h2 id="members" className="subsection-title">{t('members')}</h2>
            <ul className="divide-y divide-border text-sm">
              {detail.members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span><span className="font-medium">{m.display_name ?? '—'}</span> <span className="text-muted" dir="ltr">{m.email}</span></span>
                  <span className="text-muted">{tr(m.role)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">{t('jobsLine', { draft: detail.jobs.find((j) => j.status === 'draft')?.count ?? 0, published: detail.jobs.find((j) => j.status === 'published')?.count ?? 0, closed: detail.jobs.find((j) => j.status === 'closed')?.count ?? 0 })}</p>
          </section>
        </div>
        <aside className="space-y-6">
          <section aria-labelledby="decide" className="card space-y-3">
            <h2 id="decide" className="subsection-title">{t('decision')}</h2>
            <AdminOrganizationActions id={id} status={o.verification_status} />
          </section>
          <section aria-labelledby="history" className="card space-y-3">
            <h2 id="history" className="subsection-title">{tv('historyHeading')}</h2>
            <ReviewHistory requests={detail.requests} showPeople />
          </section>
          <section aria-labelledby="trail" className="card space-y-3">
            <h2 id="trail" className="subsection-title">{t('audit')}</h2>
            {detail.audit.length === 0 ? <p className="text-sm text-muted">{t('noAudit')}</p> : (
              <ol className="space-y-2 text-sm">
                {detail.audit.map((a) => (
                  <li key={a.id}>
                    <p><span className="font-medium">{t(`action.${a.action}`)}</span> <span className="text-muted">· {formatWhen(locale, a.created_at, 'Asia/Riyadh')}</span></p>
                    {a.actor_email && <p className="text-xs text-muted" dir="ltr">{a.actor_email}</p>}
                    {a.details.reason && <p dir="auto" className="text-xs">{a.details.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
