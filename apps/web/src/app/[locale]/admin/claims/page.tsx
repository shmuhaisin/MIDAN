import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClaimReview, type AdminClaim } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { api } from '@/lib/api';

const TONES: Record<string, 'active' | 'danger' | 'neutral' | 'warning'> = { pending: 'warning', approved: 'active', rejected: 'danger', withdrawn: 'neutral' };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.claims' });
  const claims = await api<AdminClaim[]>('/admin/employer-claims');
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      {claims.length === 0 ? <EmptyState title={t('empty')} body={t('emptyBody')} /> : (
        <ul className="space-y-3">
          {claims.map((c) => (
            <li key={c.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="subsection-title">{t('heading', { org: locale === 'ar' ? c.org_name_ar : c.org_name_en, employer: locale === 'ar' ? c.employer_name_ar : c.employer_name_en })}</h2>
                <Badge tone={TONES[c.status]}>{t(`status.${c.status}`)}</Badge>
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-muted">{t('requester')}: </dt><dd className="inline" dir="ltr">{c.requested_by_email ?? '—'}</dd></div>
                <div><dt className="inline text-muted">{t('roleTitle')}: </dt><dd className="inline" dir="auto">{c.role_title}</dd></div>
                <div><dt className="inline text-muted">{t('companyId')}: </dt><dd className="inline" dir="ltr">{c.source_company_id}</dd></div>
                <div><dt className="inline text-muted">{t('website')}: </dt><dd className="inline" dir="ltr">{c.official_website ?? '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-muted">{t('emailDomain')}: </dt><dd className="inline">{t(c.email_domain_matches ? 'domainMatches' : 'domainDiffers')}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted">{t('evidence')}:</dt><dd dir="auto" className="whitespace-pre-line">{c.evidence_note}</dd></div>
                {c.review_note && <div className="sm:col-span-2"><dt className="inline text-muted">{t('decisionNote')}: </dt><dd className="inline" dir="auto">{c.review_note}</dd></div>}
              </dl>
              {c.is_test && <p className="text-sm text-muted">{t('testOrg')}</p>}
              <ClaimReview claim={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
