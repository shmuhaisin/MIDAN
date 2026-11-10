import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AliasForm } from '@/components/admin';
import { Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { requirePlatformAdmin } from '@/lib/platform-admin';

type Employer = {
  id: string; source_company_id: string; name_ar: string; name_en: string; entity_type: string | null; sector: string | null; official_website: string | null;
  career_url: string | null; verification_source: string | null; verification_status: string; partnership_status: string; identity_status: string | null;
  usage_permission: string | null; notes: string | null; brand_notes: string | null; brand_usable: boolean; source_file: string; source_sheet: string | null; source_row: number | null;
  aliases: { name_variant: string; language: string; alias_status: string; source_row: number | null; added_by_admin: boolean }[];
  sources: { source_url: string; source_type: string; checked_on: string | null; source_row: number | null }[];
  listings: number;
};

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.employers' });
  const employers = await api<Employer[]>('/admin/employers');
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <ul className="space-y-3">
        {employers.map((e) => (
          <li key={e.id}>
            <details className="card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                <span><span className="font-semibold">{e.name_ar}</span> <span className="text-muted" dir="ltr">· {e.name_en}</span> <span className="text-xs text-muted" dir="ltr">({e.source_company_id})</span></span>
                <span className="flex flex-wrap gap-2">
                  <Badge tone={e.verification_status === 'verified_official' ? 'active' : 'warning'}>{t.has(`verification.${e.verification_status}`) ? t(`verification.${e.verification_status}`) : e.verification_status}</Badge>
                  <Badge>{t.has(`partnership.${e.partnership_status}`) ? t(`partnership.${e.partnership_status}`) : e.partnership_status}</Badge>
                  <Badge tone={e.brand_usable ? 'active' : 'neutral'}>{e.brand_usable ? t('brandAllowed') : t('brandNeutral')}</Badge>
                </span>
              </summary>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">{t('entityType')}</dt><dd dir="ltr" className="text-start">{e.entity_type ?? '—'}</dd></div>
                <div><dt className="text-muted">{t('sector')}</dt><dd dir="ltr" className="text-start">{e.sector ?? '—'}</dd></div>
                <div><dt className="text-muted">{t('website')}</dt><dd dir="ltr" className="text-start break-all">{e.official_website ?? '—'}</dd></div>
                <div><dt className="text-muted">{t('careers')}</dt><dd dir="ltr" className="text-start break-all">{e.career_url ?? t('none')}</dd></div>
                <div><dt className="text-muted">{t('verificationSource')}</dt><dd dir="ltr" className="text-start break-all">{e.verification_source ?? '—'}</dd></div>
                <div><dt className="text-muted">{t('identity')}</dt><dd>{e.identity_status ?? '—'} · {e.usage_permission ?? '—'}</dd></div>
                {e.notes && <div className="sm:col-span-2"><dt className="text-muted">{t('notes')}</dt><dd dir="ltr" className="text-start">{e.notes}</dd></div>}
                {e.brand_notes && <div className="sm:col-span-2"><dt className="text-muted">{t('brandNotes')}</dt><dd dir="ltr" className="text-start">{e.brand_notes}</dd></div>}
                <div className="sm:col-span-2"><dt className="text-muted">{t('lineage')}</dt><dd>{e.source_file} · {e.source_sheet} · {t('row', { row: e.source_row ?? 0 })}</dd></div>
                <div><dt className="text-muted">{t('listings')}</dt><dd className="tabular-nums">{number(locale, e.listings)}</dd></div>
              </dl>
              <h3 className="mt-4 subsection-title">{t('aliases')}</h3>
              <ul className="mt-1 flex flex-wrap gap-2 text-sm">
                {e.aliases.map((a) => <li key={a.name_variant} className="rounded-full border border-border px-3 py-1">{a.name_variant} <span className="text-muted">· {t.has(`aliasStatus.${a.alias_status}`) ? t(`aliasStatus.${a.alias_status}`) : a.alias_status}</span></li>)}
              </ul>
              <div className="mt-3"><AliasForm registryId={e.id} /></div>
              <h3 className="mt-4 subsection-title">{t('sources')}</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {e.sources.map((s) => <li key={s.source_url} dir="ltr" className="break-all text-start">{s.source_url} <span className="text-muted">· {s.source_type} · {s.checked_on ?? '—'}</span></li>)}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
