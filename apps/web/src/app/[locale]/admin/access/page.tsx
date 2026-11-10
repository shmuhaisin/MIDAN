import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AccessDecision, type AccessRequest } from '@/components/employer-access';
import { Badge, EmptyState } from '@/components/ui';
import { api, apiForPage } from '@/lib/api';
import { formatWhen } from '@/lib/format';

const TONES: Record<string, 'active' | 'danger' | 'neutral' | 'warning'> = { pending_approval: 'warning', approved: 'active', rejected: 'danger', revoked: 'neutral' };
type Workspace = { registry_id: string; name_ar: string | null; name_en: string | null; partnership_status: string; org_id: string | null; is_test: boolean | null; members: { user_id: string; email: string; role: string }[] };
type Event = { id: number; action: string; request_id: string; created_at: string; actor_email: string | null; details: { registry_id?: string; role?: string } };

// The platform administrator's review of employer access: who asked for which supported employer, the decision, the
// workspaces and their members, and every decision on record. Only platform administrators reach /admin (PlatformAdminGuard).
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  // Layouts and pages can render concurrently. Stop here before privileged reads for denied sessions.
  if (process.env.NODE_ENV === 'production' || !(await apiForPage('/admin/overview'))) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'employerAccess.admin' });
  const [requests, workspaces, history] = await Promise.all([
    api<AccessRequest[]>('/admin/employer-access'),
    api<Workspace[]>('/admin/employer-access/workspaces'),
    api<Event[]>('/admin/employer-access/history'),
  ]);
  const name = (ar: string | null | undefined, en: string | null | undefined) => (locale === 'ar' ? ar : en) ?? en ?? ar ?? '';
  const employerOf = new Map(workspaces.map((w) => [w.registry_id, name(w.name_ar, w.name_en)]));
  const pending = requests.filter((r) => r.status === 'pending_approval').length;
  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted">{t('lead')}</p>
      <section aria-labelledby="access-requests" className="space-y-3">
        <h2 id="access-requests" className="section-title">{t('requests', { pending })}</h2>
        {requests.length === 0 ? <EmptyState title={t('empty')} body={t('emptyBody')} /> : (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="card space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="subsection-title">{t('heading', { person: r.representative_name, employer: name(r.employer_name_ar, r.employer_name_en) })}</h3>
                  <Badge tone={TONES[r.status]}>{t(`status.${r.status}`)}</Badge>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div><dt className="inline text-muted">{t('email')}: </dt><dd className="inline" dir="ltr">{r.work_email}</dd></div>
                  <div><dt className="inline text-muted">{t('jobTitle')}: </dt><dd className="inline" dir="auto">{r.job_title}</dd></div>
                  <div><dt className="inline text-muted">{t('phone')}: </dt><dd className="inline" dir="ltr">{r.phone ?? '—'}</dd></div>
                  <div><dt className="inline text-muted">{t('source')}: </dt><dd className="inline">{t(`sources.${r.source}`)}</dd></div>
                  <div><dt className="inline text-muted">{t('submitted')}: </dt><dd className="inline">{formatWhen(locale, r.created_at, 'Asia/Riyadh')}</dd></div>
                  <div><dt className="inline text-muted">{t('partnership')}: </dt><dd className="inline">{t('notPartner')}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-muted">{t('verification')}:</dt><dd dir="auto" className="whitespace-pre-line">{r.verification_note ?? t('none')}</dd></div>
                  {r.granted_role && <div><dt className="inline text-muted">{t('granted')}: </dt><dd className="inline">{t(`roles.${r.granted_role}`)}{r.org_is_test ? ` · ${t('testWorkspace')}` : ''}</dd></div>}
                  {r.decision_note && <div className="sm:col-span-2"><dt className="inline text-muted">{t('decisionNote')}: </dt><dd className="inline" dir="auto">{r.decision_note}</dd></div>}
                  {r.decided_by_email && <div className="sm:col-span-2"><dt className="inline text-muted">{t('decidedBy')}: </dt><dd className="inline" dir="ltr">{r.decided_by_email}</dd></div>}
                </dl>
                <AccessDecision request={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="access-workspaces" className="space-y-3">
        <h2 id="access-workspaces" className="section-title">{t('workspaces')}</h2>
        <p className="max-w-3xl text-sm text-muted">{t('workspacesLead')}</p>
        <ul className="grid gap-3 md:grid-cols-2">
          {workspaces.map((w) => (
            <li key={`${w.registry_id}-${w.org_id ?? 'none'}`} className="card space-y-1 text-sm">
              <p className="font-semibold">{name(w.name_ar, w.name_en)}{w.is_test ? ` · ${t('testWorkspace')}` : ''}</p>
              {w.org_id ? (
                w.members.length ? <ul className="space-y-0.5">{w.members.map((m) => <li key={m.user_id}><bdi dir="ltr">{m.email}</bdi> · {t(`roles.${m.role}`)}</li>)}</ul> : <p className="text-muted">{t('noMembers')}</p>
              ) : <p className="text-muted">{t('noWorkspace')}</p>}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="access-history" className="space-y-3">
        <h2 id="access-history" className="section-title">{t('history')}</h2>
        {history.length === 0 ? <p className="text-sm text-muted">{t('noHistory')}</p> : (
          <ul className="divide-y divide-border text-sm">
            {history.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{t(`actions.${e.action}`)} · {employerOf.get(e.details.registry_id ?? '') ?? '—'}{e.details.role ? ` · ${t(`roles.${e.details.role}`)}` : ''}</span>
                <span className="text-muted"><bdi dir="ltr">{e.actor_email ?? '—'}</bdi> · {formatWhen(locale, e.created_at, 'Asia/Riyadh')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
