import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminGrantForm, EmployerLinkForm } from '@/components/admin';
import { Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, number } from '@/lib/format';
import { Cell, DataTable } from '../admin-kit';

type User = { id: string; email: string; display_name: string | null; created_at: string; platform_admin: boolean; memberships: { org_id: string; role: string; name_ar: string; name_en: string }[] };
type Org = { employer_registry_id: string | null; id: string; slug: string; name_ar: string; name_en: string; is_demo: boolean; is_test: boolean; members: number; jobs: number; published_jobs: number; created_at: string };

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }> }) {
  const { locale } = await params;
  const { q = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.accounts' });
  const [users, orgs, employers] = await Promise.all([
    api<User[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`), api<Org[]>('/admin/organizations'),
    api<{ id: string; source_company_id: string; name_ar: string; name_en: string }[]>('/reference/employers'),
  ]);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="section-title">{t('admins')}</h2>
        <p className="max-w-3xl text-sm text-muted">{t('adminsLead')}</p>
        <AdminGrantForm />
      </section>
      <section className="space-y-3">
        <h2 className="section-title">{t('users')}</h2>
        <form className="flex gap-2" role="search">
          <label className="sr-only" htmlFor="q">{t('search')}</label>
          <input id="q" name="q" defaultValue={q} placeholder={t('search')} className="h-10 w-full max-w-sm px-3" />
          <button type="submit" className="btn btn-secondary btn-sm">{t('searchButton')}</button>
        </form>
        <DataTable caption={t('users')} head={[t('email'), t('name'), t('roles'), t('joined')]}>
          {users.map((u) => (
            <tr key={u.id}>
              <Cell ltr>{u.email}</Cell>
              <Cell>{u.display_name}</Cell>
              <Cell>
                <span className="flex flex-wrap gap-1">
                  {u.platform_admin && <Badge tone="active">{t('platformAdmin')}</Badge>}
                  {u.memberships.map((m) => <Badge key={m.org_id}>{locale === 'ar' ? m.name_ar : m.name_en} · {t(`orgRoles.${m.role}`)}</Badge>)}
                </span>
              </Cell>
              <Cell>{formatDate(locale, u.created_at, 'Asia/Riyadh')}</Cell>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="space-y-3">
        <h2 className="section-title">{t('organizations')}</h2>
        <p className="max-w-3xl text-sm text-muted">{t('linkLead')}</p>
        <DataTable caption={t('organizations')} head={[t('organization'), t('kind'), t('members'), t('jobs'), t('employerLink')]}>
          {orgs.map((o) => (
            <tr key={o.id}>
              <Cell>{locale === 'ar' ? o.name_ar : o.name_en} <span className="text-xs text-muted" dir="ltr">{o.slug}</span></Cell>
              <Cell>{o.is_test ? <Badge tone="warning">{t('test')}</Badge> : o.is_demo ? <Badge>{t('demo')}</Badge> : <Badge tone="active">{t('real')}</Badge>}</Cell>
              <Cell className="tabular-nums">{number(locale, o.members)}</Cell>
              <Cell className="tabular-nums">{number(locale, o.published_jobs)} / {number(locale, o.jobs)}</Cell>
              <Cell>{o.is_test || o.is_demo ? '—' : <EmployerLinkForm orgId={o.id} current={o.employer_registry_id} employers={employers} />}</Cell>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}
