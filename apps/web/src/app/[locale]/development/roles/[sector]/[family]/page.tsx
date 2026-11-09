import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChooseRoleButton } from '@/components/career-client';
import { Panel } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { type Career, type Family, type FamilySkill, SECTOR_KEYS } from '@/lib/career';
import { number } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * One job family as the sector workbook describes it: its technical and general skills, with each skill's description
 * and whether the workbook marks it as a priority. Responsibilities, tools and typical experience aren't in the
 * workbooks, so they aren't shown or made up.
 */
export default async function Page({ params }: { params: Promise<{ locale: string; sector: string; family: string }> }) {
  const { locale, sector, family: encoded } = await params;
  setRequestLocale(locale);
  const family = decodeURIComponent(encoded);
  if (!SECTOR_KEYS.includes(sector as (typeof SECTOR_KEYS)[number])) notFound();
  if (!(await getSession())) return redirect({ href: `/login?next=/development/roles/${sector}/${encoded}`, locale });
  const qs = new URLSearchParams({ family, sector }).toString();
  const [families, skills, career] = await Promise.all([
    apiForPage<Family[]>(`/reference/job-families?sector=${sector}`),
    apiForPage<FamilySkill[]>(`/reference/skills?${qs}`),
    apiForPage<Career>('/me/career'),
  ]);
  const known = (families ?? []).find((f) => f.job_family_ar === family);
  if (families && !known) notFound();
  const t = await getTranslations({ locale, namespace: 'career' });
  const ts = await getTranslations({ locale, namespace: 'sectors' });
  const n = (v: number) => number(locale, v);
  const list = skills ?? [];
  const technical = list.filter((s) => s.skill_kind === 'technical');
  const general = list.filter((s) => s.skill_kind !== 'technical');
  const target = career?.target ?? null;
  const current = target?.sector_code === sector && target?.job_family_ar === family;
  const listed = new Set((career?.role_skills ?? []).filter((s) => s.evidence === 'self_reported').map((s) => s.id));

  const group = (id: string, title: string, lead: string, items: FamilySkill[]) => items.length > 0 && (
    <Panel id={id} title={title} lead={lead} count={n(items.length)} flush>
      <ul className="divide-y divide-border">
        {items.map((s) => (
          <li key={s.id} className="px-6 py-4 lg:px-8">
            <p className="flex flex-wrap items-center gap-2 font-semibold" dir="rtl">
              <bdi>{s.name_ar}</bdi>
              {s.is_priority && <span className="chip border-gold/50 bg-gold/10 text-xs text-gold-text">{t('skill.priority')}</span>}
              {current && listed.has(s.id) && <span className="chip border-primary/40 text-xs text-primary">{t('skill.evidence.self_reported')}</span>}
            </p>
            {s.description_ar && <p dir="rtl" className="mt-1 text-sm leading-relaxed text-muted">{s.description_ar}</p>}
          </li>
        ))}
      </ul>
    </Panel>
  );

  return (
    <div className="container-page space-y-8 py-8 lg:py-10">
      <nav aria-label={t('roleDetail.breadcrumb')} className="text-sm text-muted">
        <Link href="/development/roles" className="link">{t('nav.roles')}</Link>
        <span aria-hidden className="mx-2">/</span>
        <Link href={`/development/roles?sector=${sector}`} className="link">{ts(sector)}</Link>
      </nav>

      <header className="on-deep deep-grain grid gap-6 overflow-hidden rounded-[var(--radius-panel)] bg-deep p-6 text-deep-foreground sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-10">
        <div className="min-w-0">
          <p className="label-caps text-gold">{t('roleDetail.eyebrow', { sector: ts(sector) })}</p>
          <h1 className="display-lg mt-3 text-balance text-ivory" dir="rtl"><bdi>{family}</bdi></h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-deep-muted">{t('roleDetail.lead', { technical: n(known?.skills ?? technical.length) })}</p>
        </div>
        <ChooseRoleButton sector={sector} family={family} keepTitle={target?.job_title} current={current} />
      </header>

      {skills === null && <p role="alert" className="callout text-sm">{t('loadFailed')}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {group('technical', t('roleDetail.technical'), t('roleDetail.technicalLead'), technical)}
          {group('general', t('roleDetail.general'), t('roleDetail.generalLead'), general)}
          {list.length === 0 && skills !== null && <p className="text-sm text-muted">{t('roleDetail.noSkills')}</p>}
          {list.length >= 30 && <p className="text-xs text-muted">{t('roleDetail.capped')}</p>}
        </div>
        <aside className="space-y-4 self-start xl:sticky xl:top-24">
          <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-6">
            <p className="font-display text-lg font-bold">{t('roleDetail.afterTitle')}</p>
            <ol className="mt-3 space-y-3 text-sm leading-relaxed">
              {(t.raw('roleDetail.after') as string[]).map((line, i) => (
                <li key={line} className="flex gap-3"><span aria-hidden className="num font-semibold text-gold-text">{n(i + 1)}</span><span>{line}</span></li>
              ))}
            </ol>
          </div>
          <div className="rounded-[var(--radius-panel)] border border-dashed border-border-strong p-6 text-sm leading-relaxed text-muted">
            <p className="font-semibold text-foreground">{t('roleDetail.missingTitle')}</p>
            <p className="mt-1">{t('roleDetail.missingBody')}</p>
          </div>
          <Link href={`/opportunities?sector=${sector}`} className="link block text-sm">{t('roleDetail.jobs', { sector: ts(sector) })}</Link>
        </aside>
      </div>

      <p className="text-xs text-muted">{t('source')}</p>
    </div>
  );
}
