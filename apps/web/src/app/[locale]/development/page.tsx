import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CareerTargetPicker, PlanItemControls, SavePlanButton } from '@/components/candidate';
import { Link } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { formatDate, pick } from '@/lib/format';

type Resource = { id: string; kind: string; title_ar: string | null; title_en: string | null; provider: string; url: string; verified_on: string };
type RoleSkill = { id: string; name_ar: string; description_ar: string | null; is_priority: boolean | null; source_file: string; evidence: 'self_reported' | 'no_evidence'; resources: Resource[] };
type Career = {
  target: { sector_code: string; job_family_ar: string } | null;
  role_skills: RoleSkill[];
  demonstrated_needs: { id: string; name_ar: string; name_en: string; level: number }[];
  demonstrated_strengths: { id: string; name_ar: string; name_en: string; level: number }[];
  plan: { id: string; kind: string; status: string; reference_skills: { id: string; name_ar: string }; learning_resources: Resource | null }[];
};
type Family = { sector_code: string; job_family_ar: string; skills: number };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [career, families] = await Promise.all([apiForPage<Career>('/me/career'), apiForPage<Family[]>('/reference/job-families')]);
  const t = await getTranslations({ locale, namespace: 'development' });
  const ts = await getTranslations({ locale, namespace: 'sectors' });
  const data = career ?? { target: null, role_skills: [], demonstrated_needs: [], demonstrated_strengths: [], plan: [] };
  const inPlan = (skill: string, kind: string, resource?: string) => data.plan.some((p) => p.reference_skills.id === skill && p.kind === kind && (p.learning_resources?.id ?? undefined) === resource);
  const title = (r: Resource) => pick(locale, r.title_ar ?? r.title_en ?? '', r.title_en ?? r.title_ar ?? '');
  return (
    <>
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
        <header>
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="mt-2 max-w-2xl text-muted">{t('lead')}</p>
          </div>
          
        </header>

        <section aria-labelledby="target">
          <h2 id="target" className="mb-3 section-title">{t('targetTitle')}</h2>
          <CareerTargetPicker families={families ?? []} target={data.target} />
          {data.target && <p className="mt-3 text-sm text-muted">{t('targetNote', { family: data.target.job_family_ar, sector: ts(data.target.sector_code) })}</p>}
        </section>

        {(data.demonstrated_needs.length > 0 || data.demonstrated_strengths.length > 0) && (
          <section aria-labelledby="evidence">
            <h2 id="evidence" className="section-title">{t('evidenceTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('evidenceNote')}</p>
            {data.demonstrated_strengths.length > 0 && <p className="mt-3"><span className="font-semibold">{t('strengths')}: </span>{data.demonstrated_strengths.map((s) => pick(locale, s.name_ar, s.name_en)).join(locale === 'ar' ? '، ' : ', ')}</p>}
            {data.demonstrated_needs.length > 0 && <p className="mt-2"><span className="font-semibold">{t('needs')}: </span>{data.demonstrated_needs.map((s) => pick(locale, s.name_ar, s.name_en)).join(locale === 'ar' ? '، ' : ', ')}</p>}
          </section>
        )}

        {data.target && (
          <section aria-labelledby="gaps">
            <h2 id="gaps" className="section-title">{t('gapsTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('gapsNote')}</p>
            <ul className="mt-3 border-t border-border">
              {data.role_skills.map((s) => (
                <li key={s.id} className="border-b border-border py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.name_ar}{s.is_priority && <span className="ms-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{t('priority')}</span>}</p>
                      {s.description_ar && <p className="mt-1 text-sm text-muted">{s.description_ar}</p>}
                      <p className="mt-1 text-sm">{t(`reason.${s.evidence}`)}</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <SavePlanButton skillId={s.id} kind="skill_goal" saved={inPlan(s.id, 'skill_goal')} label={t('saveGoal')} />
                      <SavePlanButton skillId={s.id} kind="project" saved={inPlan(s.id, 'project')} label={t('saveProject')} />
                    </div>
                  </div>
                  {s.resources.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {s.resources.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">{title(r)}</a>
                          <span className="text-muted">{r.provider} · {t('verifiedOn', { date: formatDate(locale, r.verified_on, 'UTC') })}</span>
                          <SavePlanButton skillId={s.id} kind={r.kind} resourceId={r.id} saved={inPlan(s.id, r.kind, r.id)} label={t('saveResource')} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {data.role_skills.every((s) => s.resources.length === 0) && <p className="mt-4 border-s-2 border-gold ps-4 text-sm">{t('noCatalog')}</p>}
            <p className="mt-3 text-xs text-muted">{t('source')}</p>
          </section>
        )}

        <section aria-labelledby="plan">
          <h2 id="plan" className="section-title">{t('planTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('planNote')}</p>
          {data.plan.length === 0 ? <p className="mt-3 text-muted">{t('planEmpty')}</p> : (
            <ul className="mt-3 border-t border-border">
              {data.plan.map((p) => {
                const label = p.learning_resources ? title(p.learning_resources) : t(`kind.${p.kind}`, { skill: p.reference_skills.name_ar });
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
                    <span className="min-w-0 flex-1 font-medium">{label}</span>
                    <PlanItemControls id={p.id} status={p.status} label={label} />
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/opportunities" className="mt-4 inline-block font-semibold text-primary underline underline-offset-4">{t('browseJobs')}</Link>
        </section>
      </div>
    </>
  );
}
