import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResourceForm } from '@/components/admin';
import { EmptyState } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';

type Resource = { id: string; kind: string; title_ar: string | null; title_en: string | null; provider: string; url: string; verified_on: string; skill_name_ar: string | null; sector_code: string | null };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.learning' });
  const resources = await api<Resource[]>('/admin/learning-resources');
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      {resources.length === 0 ? <EmptyState title={t('empty')} body={t('emptyBody')} /> : (
        <DataTable caption={t('title')} head={[t('kind'), t('titleCol'), t('provider'), t('skill'), t('verifiedOn')]}>
          {resources.map((r) => (
            <tr key={r.id}>
              <Cell>{t(r.kind)}</Cell>
              <Cell><a href={r.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{r.title_ar ?? r.title_en}</a></Cell>
              <Cell>{r.provider}</Cell><Cell>{r.skill_name_ar}</Cell>
              <Cell>{formatDate(locale, r.verified_on, 'UTC')}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <ResourceForm />
    </div>
  );
}
