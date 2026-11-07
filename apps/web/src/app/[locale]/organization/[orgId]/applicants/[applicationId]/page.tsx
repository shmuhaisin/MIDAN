import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ApplicantStatus } from '@/components/forms';
import { HiringPanel } from '@/components/hiring-panel';
import { ApplicationNotes, InterviewFeedback } from '@/components/applicant-review';
import { ApplicantCvButton } from '@/components/profile';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { canReopenApplications } from '@/lib/application-status';
import { formatDate, formatWhen, number, pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Person = { user_id: string; email: string | null; display_name: string | null; role: string | null } | null;
type Named = { id: string; name_ar: string; name_en: string | null };
type Item = { title?: string; qualification?: string; organization?: string; institution?: string; field?: string; description?: string; start_year?: number | null; end_year?: number | null };
type Feedback = {
  id: string; status: 'draft' | 'submitted'; recommendation: string | null; notes: string | null; submitted_at: string | null; author_id: string;
  competencies: { label: string; rating: number | null; evidence: string }[]; author: Person;
};
type Review = {
  id: string; status: string; created_at: string; cover_note: string | null; has_cv: boolean; captured_at: string | null; my_role: string | null; my_user_id: string;
  job: { id: string; title_ar: string; title_en: string };
  profile: null | {
    full_name?: string; headline?: string | null; city?: string | null; summary?: string | null; years_experience?: string | null; email: string | null; phone?: string | null;
    experience?: Item[]; education?: Item[]; projects?: Item[]; courses?: Item[]; certifications?: Item[]; self_reported_skills?: string[];
    languages?: { name: string; level?: string | null }[]; achievements?: Item[];
  };
  skills: { listed: Named[]; reference: { id: string; name_ar: string; skill_kind: string }[] };
  relevance: { total: number; matched: (Named & { evidence: 'listed' | 'assessed' })[]; gaps: Named[] };
  assessment_attempts: {
    id: string; status: string; submitted_at: string | null;
    assessment_versions: { version_number: number; assessments: { title_ar: string; title_en: string } };
    evaluation_results: null | {
      id: string; status: string; overall_score: string | null; released_to_candidate: boolean; ai_mode: string | null;
      skill_scores: { level: number; skills: Named }[];
      reference_skill_scores: { score_pct: string; reference_skills: { id: string; name_ar: string } }[];
      criterion_scores: { score: string; source: string; explanation: string | null; evidence_ref: string | null; rubric_criteria: { code: string; description_ar: string; description_en: string; max_score: string } }[];
      evaluation_reviews: { notes: string | null; created_at: string }[];
    };
  }[];
  interviews: (Parameters<typeof HiringPanel>[0]['interviews'][number] & { participants: Person[]; feedback: Feedback[]; created_by: string | null })[];
  hiring_outcomes: (Parameters<typeof HiringPanel>[0]['outcomes'][number] & { issued_by: Person })[];
  application_status_history: { id: string; from_status: string | null; to_status: string; created_at: string; changed_by: Person }[];
  notes: { id: string; body: string; created_at: string; author: Person }[];
  team: NonNullable<Person>[];
};

/** Times are shown in MIDAN's default zone, as everywhere else in the employer's screens. */
const ZONE = 'Asia/Riyadh';
const who = (p: Person) => p?.display_name || p?.email || '—';

export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string; applicationId: string }> }) {
  const { locale, orgId, applicationId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(applicationId)) notFound();
  const data = await apiForPage<Review>(`/organizations/${orgId}/applications/${applicationId}/review`);
  if (!data) notFound();
  const t = await getTranslations({ locale, namespace: 'applicant' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const tr = await getTranslations({ locale, namespace: 'review' });
  const canManage = ['owner', 'admin', 'recruiter'].includes(data.my_role ?? '');
  const profile = data.profile;
  const name = (s: Named) => pick(locale, s.name_ar, s.name_en ?? s.name_ar);
  const span = (i: Item) => (i.start_year ? `${i.start_year} – ${i.end_year ?? t('present')}` : '');
  const list = (items: Item[] | undefined, title: (i: Item) => string, sub?: (i: Item) => string) =>
    (items ?? []).length === 0 ? <p className="mt-3 text-muted">{t('none')}</p> : (
      <ul className="mt-3 border-t border-border">
        {items!.map((e, i) => (
          <li key={i} className="border-b border-border py-3">
            <p className="font-semibold"><bdi>{title(e)}</bdi></p>
            {sub && sub(e) && <p className="text-sm text-muted"><bdi>{sub(e)}</bdi></p>}
            {e.description && <p className="mt-1 leading-relaxed"><bdi>{e.description}</bdi></p>}
          </li>
        ))}
      </ul>
    );

  return (
    <article className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      <header className="space-y-3">
        <Link href={`/organization/${orgId}/jobs/${data.job.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
          <Arrow className="rotate-180" />{t('back')}
        </Link>
        <h1 className="page-title"><bdi>{profile?.full_name || profile?.email || t('noProfile')}</bdi></h1>
        {profile?.headline && <p className="text-base"><bdi>{profile.headline}</bdi></p>}
        <p className="text-muted">
          {[profile?.city, profile?.years_experience != null ? t('years', { count: number(locale, Number(profile.years_experience)) }) : null].filter(Boolean).join(' · ')}
        </p>
        <p className="text-sm font-medium">{t('appliedFor', { job: pick(locale, data.job.title_ar, data.job.title_en) })} · {formatDate(locale, data.created_at, ZONE)}</p>
        {profile && (
          <p className="text-sm text-muted">
            {profile.email && <bdi dir="ltr">{profile.email}</bdi>}{profile.phone && <> · <bdi dir="ltr">{profile.phone}</bdi></>}
          </p>
        )}
        <p className="border-s-2 border-gold ps-4 text-sm">{t('snapshotNote', { date: data.captured_at ? formatDate(locale, data.captured_at, ZONE) : '—' })}</p>
        <div className="flex flex-wrap items-end gap-6 pt-2">
          <div>
            <p className="text-sm font-medium">{t('statusNow')}</p>
            {canManage ? <ApplicantStatus id={data.id} status={data.status} label={t('statusLabel')} canReopen={canReopenApplications(data.my_role ?? undefined)} />
              : <p className="mt-1 font-semibold">{ts(data.status)}</p>}
          </div>
        </div>
        <p className="text-sm text-muted">{t('decisionsNote')}</p>
      </header>

      {data.cover_note && (
        <section aria-labelledby="cover"><h2 id="cover" className="section-title">{t('coverNote')}</h2><p className="mt-3 max-w-3xl leading-relaxed whitespace-pre-line"><bdi>{data.cover_note}</bdi></p></section>
      )}

      <section aria-labelledby="relevance">
        <h2 id="relevance" className="section-title">{t('relevanceTitle')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t('relevanceNote')}</p>
        {data.relevance.total === 0 ? <p className="mt-3 text-muted">{t('relevanceNone')}</p> : (
          <>
            <p className="mt-3 font-semibold">{t('relevanceCount', { matched: number(locale, data.relevance.matched.length), total: number(locale, data.relevance.total) })}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.relevance.matched.map((s) => (
                <li key={s.id} className={s.evidence === 'assessed' ? 'rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground' : 'rounded-full border border-border px-3 py-1 text-sm'}>
                  {name(s)} · {t(`evidence.${s.evidence}`)}
                </li>
              ))}
            </ul>
            {data.relevance.gaps.length > 0 && <p className="mt-3 text-sm text-muted">{t('relevanceGaps')}: {data.relevance.gaps.map(name).join(locale === 'ar' ? '، ' : ', ')}</p>}
          </>
        )}
      </section>

      <section aria-labelledby="assessments">
        <h2 id="assessments" className="section-title">{t('assessmentsTitle')}</h2>
        {data.assessment_attempts.length === 0 ? <p className="mt-3 text-muted">{t('assessmentsNone')}</p> : (
          <ul className="mt-3 space-y-8">
            {data.assessment_attempts.map((a) => {
              const e = a.evaluation_results;
              return (
                <li key={a.id} className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="font-semibold">{pick(locale, a.assessment_versions.assessments.title_ar, a.assessment_versions.assessments.title_en)} · {t('version', { number: a.assessment_versions.version_number })}</p>
                    {a.status === 'submitted' && <Link href={`/organization/${orgId}/review/${a.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4">{t('openReview')}<Arrow /></Link>}
                  </div>
                  <p className="text-sm text-muted">{t(`attempt.${a.status}`)}{a.submitted_at && ` · ${formatDate(locale, a.submitted_at, ZONE)}`}</p>
                  {!e && a.status === 'submitted' && <p className="mt-2 text-sm">{t('notEvaluated')}</p>}
                  {e && (
                    <div className="mt-3 space-y-4">
                      <p className="text-sm">
                        <span className="font-semibold">{t(`evaluation.${e.status}`)}</span>
                        {e.status === 'reviewed' && e.overall_score != null && <> · {t('overall', { score: number(locale, Number(e.overall_score)) })}</>}
                        {e.ai_mode === 'demo' && <> · {t('demoMode')}</>}
                      </p>
                      {e.status !== 'reviewed' && <p className="text-sm text-muted">{t('proposalsOnly')}</p>}
                      {e.skill_scores.length > 0 && (
                        <p className="text-sm"><span className="font-semibold">{tr('skillLevels')}: </span>{e.skill_scores.map((s) => `${name(s.skills)} L${s.level}`).join(locale === 'ar' ? '، ' : ', ')}</p>
                      )}
                      {e.reference_skill_scores.length > 0 && (
                        <p className="text-sm"><span className="font-semibold">{tr('workbookSkills')}: </span>{e.reference_skill_scores.map((s) => `${s.reference_skills.name_ar} ${number(locale, Number(s.score_pct))}%`).join('، ')}</p>
                      )}
                      {e.criterion_scores.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[36rem] text-start text-sm">
                            <thead className="border-b border-border text-muted">
                              <tr><th className="py-2 text-start font-medium">{t('criterion')}</th><th className="py-2 text-start font-medium">{t('score')}</th><th className="py-2 text-start font-medium">{t('evidenceCol')}</th></tr>
                            </thead>
                            <tbody>
                              {e.criterion_scores.sort((x, y) => x.rubric_criteria.code.localeCompare(y.rubric_criteria.code)).map((c) => (
                                <tr key={c.rubric_criteria.code} className="border-b border-border align-top">
                                  <td className="py-2 pe-4"><span className="font-semibold">{c.rubric_criteria.code}</span> {pick(locale, c.rubric_criteria.description_ar, c.rubric_criteria.description_en)}</td>
                                  <td className="py-2 pe-4 tabular-nums whitespace-nowrap">{number(locale, Number(c.score))} / {number(locale, Number(c.rubric_criteria.max_score))}<br /><span className="text-muted">{t(`source.${c.source}`)}</span></td>
                                  <td className="py-2">{c.evidence_ref && <q className="block"><bdi>{c.evidence_ref}</bdi></q>}{c.explanation && <span className="text-muted"><bdi>{c.explanation}</bdi></span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {e.evaluation_reviews.filter((r) => r.notes).map((r, i) => (
                        <p key={i} className="border-s-2 border-border ps-3 text-sm"><span className="font-semibold">{t('assessorNote')}: </span><bdi>{r.notes}</bdi></p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="profile">
        <h2 id="profile" className="section-title">{t('profileTitle')}</h2>
        {profile?.summary && <p className="mt-3 max-w-3xl leading-relaxed whitespace-pre-line"><bdi>{profile.summary}</bdi></p>}
        <h3 className="mt-6 font-semibold">{t('skills')}</h3>
        <p className="mt-1 text-sm text-muted">{t('skillsNote')}</p>
        {data.skills.listed.length + data.skills.reference.length + (profile?.self_reported_skills?.length ?? 0) === 0 ? <p className="mt-3 text-muted">{t('none')}</p> : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {data.skills.reference.map((s) => <li key={s.id} className="rounded-full border border-border px-3 py-1 text-sm">{s.name_ar}</li>)}
            {data.skills.listed.map((s) => <li key={s.id} className="rounded-full bg-surface-2 px-3 py-1 text-sm">{name(s)}</li>)}
            {profile?.self_reported_skills?.map((s) => <li key={s} className="rounded-full border border-dashed border-border px-3 py-1 text-sm"><bdi>{s}</bdi></li>)}
          </ul>
        )}
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <div><h3 className="font-semibold">{t('experience')}</h3>{list(profile?.experience, (e) => [e.title, e.organization].filter(Boolean).join(' · '), span)}</div>
          <div><h3 className="font-semibold">{t('education')}</h3>{list(profile?.education, (e) => [e.qualification, e.field].filter(Boolean).join(' · '), (e) => [e.institution, span(e)].filter(Boolean).join(' · '))}</div>
          <div><h3 className="font-semibold">{t('projects')}</h3>{list(profile?.projects, (e) => e.title ?? '')}</div>
          <div><h3 className="font-semibold">{t('certifications')}</h3>{list([...(profile?.certifications ?? []), ...(profile?.courses ?? [])], (e) => e.title ?? '')}</div>
          <div><h3 className="font-semibold">{t('achievements')}</h3>{list(profile?.achievements, (e) => e.title ?? '')}</div>
          <div><h3 className="font-semibold">{t('languages')}</h3>{list((profile?.languages ?? []).map((l) => ({ title: [l.name, l.level].filter(Boolean).join(' · ') })), (e) => e.title ?? '')}</div>
        </div>
        <h3 className="mt-6 font-semibold">{t('cv')}</h3>
        <div className="mt-3">{data.has_cv ? <ApplicantCvButton applicationId={applicationId} /> : <p className="text-muted">{t('cvNone')}</p>}</div>
      </section>

      <HiringPanel orgId={orgId} applicationId={applicationId} interviews={data.interviews} outcomes={data.hiring_outcomes} canManage={canManage} status={data.status}
        team={data.team.filter((m) => m.user_id !== data.my_user_id)} />

      {data.interviews.length > 0 && (
        <section aria-labelledby="feedback">
          <h2 id="feedback" className="section-title">{t('feedbackTitle')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t('feedbackNote')}</p>
          <ul className="mt-3 space-y-8">
            {data.interviews.map((i) => (
              <li key={i.id} className="border-t border-border pt-4">
                <p className="font-semibold">{formatWhen(locale, i.scheduled_at, i.time_zone)}</p>
                <p className="text-sm text-muted">{t('participants')}: {i.participants.map(who).join(locale === 'ar' ? '، ' : ', ')}</p>
                <InterviewFeedback
                  orgId={orgId} applicationId={applicationId} interviewId={i.id}
                  canWrite={i.participants.some((p) => p?.user_id === data.my_user_id) && i.status !== 'cancelled'}
                  mine={i.feedback.find((f) => f.author_id === data.my_user_id) ?? null}
                  submitted={i.feedback.filter((f) => f.status === 'submitted').map((f) => ({ ...f, authorName: who(f.author) }))}
                  suggested={[...data.relevance.matched, ...data.relevance.gaps].map(name)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ApplicationNotes orgId={orgId} applicationId={applicationId} notes={data.notes.map((n) => ({ ...n, authorName: who(n.author) }))} />

      <section aria-labelledby="history">
        <h2 id="history" className="section-title">{t('historyTitle')}</h2>
        <ol className="mt-3 border-s border-border ps-5">
          {data.application_status_history.map((h) => (
            <li key={h.id} className="relative pb-4">
              <span aria-hidden className="absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full bg-primary" />
              <p className="font-semibold">{ts(h.to_status)}</p>
              <p className="text-sm text-muted">{formatDate(locale, h.created_at, ZONE)}{h.changed_by && ` · ${who(h.changed_by)}`}</p>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
