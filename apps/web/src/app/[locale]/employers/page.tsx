import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, PageHeader } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { pick } from '@/lib/format';

type Employer = {
  id: string; name_ar: string; name_en: string; entity_type: string | null; sector: string | null; official_website: string | null; career_url: string | null; verification_status: string;
};

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'employers' });
  const employers = await api<Employer[]>('/reference/employers');
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title={t('title')} lead={t('lead')} className="mb-5">
        <Link href="/opportunities" className="text-sm font-semibold text-primary underline underline-offset-4">{t('jobs')}</Link>
      </PageHeader>
      <ul className="grid gap-3 md:grid-cols-2">
        {employers.map((e) => (
          <li key={e.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="subsection-title">{pick(locale, e.name_ar, e.name_en)}</h2>
              <Badge tone={e.verification_status === 'verified_official' ? 'active' : 'neutral'}>{t(`status.${e.verification_status}`)}</Badge>
            </div>
            {e.sector && <p className="mt-1 text-sm text-muted" dir="ltr">{e.sector}</p>}
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {e.career_url && <a href={e.career_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-4">{t('careers')}</a>}
              {e.official_website && <a href={e.official_website} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t('website')}</a>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
