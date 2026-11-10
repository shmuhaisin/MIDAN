import clsx from 'clsx';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow } from '@/components/brand';
import { ApplicantStatus } from '@/components/forms';
import { HiringPanel } from '@/components/hiring-panel';
import { ApplicationNotes, InterviewFeedback } from '@/components/applicant-review';
import { formLabels, InterviewPreparation, type Preparation } from '@/components/interview-prep';
import { ApplicantCvButton } from '@/components/profile';
import { type MatchData, RequirementMatch } from '@/components/requirement-match';
import { Badge, statusTone, Timeline } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LaneHeader, LaneTrack, Panel, STAGE_RANK } from '@/components/workspace-kit';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { canReopenApplications } from '@/lib/application-status';
import { formatDate, formatWhen, number, pick } from '@/lib/format';
import { PIPELINE } from '@/lib/org-data';
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

/**
 * One applicant as a dossier: who they are and where they stand at the top, the decision beside it, then the evidence
 * (required skills, assessments, profile), the hiring steps, the team's notes and the history.
 */
export default async function Page({ params }: { params: Promise<{ locale: string; orgId: string; applicationId: string }> }) {
  const { locale, orgId, applicationId } = await params;
  setRequestLocale(locale);
  if (!(await getSession())) return redirect({ href: '/login?as=organization', locale });
  if (!/^[0-9a-f-]{36}$/.test(applicationId)) notFound();
  const [data, match] = await Promise.all([
    apiForPage<Review>(`/organizations/${orgId}/applications/${applicationId}/review`),
    apiForPage<MatchData>(`/organizations/${orgId}/applications/${applicationId}/match`),
  ]);
  if (!data) notFound();
  // Each interview's preparation (questions and form), for staff only. A failure leaves the rest of the page usable.
  const preparations = new Map(await Promise.all(data.interviews.map(async (i) =>
    [i.id, await apiForPage<Preparation>(`/organizations/${orgId}/interviews/${i.id}/preparation`).catch(() => null)] as const)));
  const t = await getTranslations({ locale, namespace: 'applicant' });
  const tm = await getTranslations({ locale, namespace: 'match' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const tr = await getTranslations({ locale, namespace: 'review' });
  const tn = await getTranslations({ locale, namespace: 'orgShell' });
  const n = (v: number) => number(locale, v);
  const canManage = ['owner', 'admin', 'recruiter'].includes(data.my_role ?? '');
  // The API allows the same roles to record a match review (BUILDERS).
  const canReview = canManage;
  const profile = data.profile;
  const name = (s: Named) => pick(locale, s.name_ar, s.name_en ?? s.name_ar);
  const sep = locale === 'ar' ? '، ' : ', ';
  const span = (i: Item) => (i.start_year ? `${i.start_year} – ${i.end_year ?? t('present')}` : '');
  const list = (items: Item[] | undefined, title: (i: Item) => string, sub?: (i: Item) => string) =>
    (items ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">{t('none')}</p> : (
      <ul className="mt-2 space-y-3">
        {items!.map((e, i) => (
          <li key={i} className="border-s-2 border-border ps-3">
            <p className="font-semibold"><bdi>{title(e)}</bdi></p>
            {sub && sub(e) && <p className="text-sm text-muted"><bdi>{sub(e)}</bdi></p>}
            {e.description && <p className="mt-1 text-sm leading-relaxed"><bdi>{e.description}</bdi></p>}
          </li>
        ))}
      </ul>
    );

  const siblings = (await apiForPage<{ id: string }[]>(`/organizations/${orgId}/applications`)) ?? [];
  const position = siblings.findIndex((x) => x.id === applicationId);
  const display = profile?.full_name || profile?.email || t('noProfile');
  const stations = PIPELINE.map(([key]) => tn(`stage.${key}`));
  const open = data.status in STAGE_RANK;
  const at = STAGE_RANK[data.status] ?? 0;
  const assessed = data.relevance.matched.filter((s) => s.evidence === 'assessed').length;
  const listed = data.relevance.matched.length - assessed;

  return (
    <article className="space-y-8">
      {/* Way back, and through the list without leaving the dossier. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/organization/${orgId}/candidates`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
          <Icon name="chevron" className="size-4 rotate-180" />{tn('candidates')}
        </Link>
        {position >= 0 && siblings.length > 1 && (
          <nav aria-label={tn('candidates')} className="flex items-center gap-2 text-sm">
            {siblings[position - 1] ? <Link href={`/organization/${orgId}/applicants/${siblings[position - 1].id}`} className="btn btn-secondary btn-sm"><Icon name="chevron" className="size-4 rotate-180" />{tn('previous')}</Link> : <span aria-disabled="true" className="btn btn-secondary btn-sm opacity-50">{tn('previous')}</span>}
            <span className="num px-1 text-muted">{tn('position', { n: position + 1, total: siblings.length })}</span>
            {siblings[position + 1] ? <Link href={`/organization/${orgId}/applicants/${siblings[position + 1].id}`} className="btn btn-secondary btn-sm">{tn('next')}<Icon name="chevron" className="size-4" /></Link> : <span aria-disabled="true" className="btn btn-secondary btn-sm opacity-50">{tn('next')}</span>}
          </nav>
        )}
      </div>

      {/* Identity and position, with the decision beside it. */}
      <header className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-[var(--radius-panel)] border border-border bg-surface">
          <div className="flex flex-wrap items-start gap-5 p-6 lg:p-8">
            <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_40%,var(--surface))] font-display text-2xl font-bold text-forest dark:text-mint">{display.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="label-caps">{t('appliedFor', { job: pick(locale, data.job.title_ar, data.job.title_en) })}</p>
              <h1 className="mt-1 font-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight font-bold"><bdi>{display}</bdi></h1>
              {profile?.headline && <p className="mt-1 text-lg text-muted"><bdi>{profile.headline}</bdi></p>}
              <ul className="mt-4 flex flex-wrap gap-2 text-sm">
                {profile?.city && <li className="rounded-full bg-surface-2 px-3 py-1"><bdi>{profile.city}</bdi></li>}
                {profile?.years_experience != null && <li className="rounded-full bg-surface-2 px-3 py-1">{t('years', { count: n(Number(profile.years_experience)) })}</li>}
                {profile?.email && <li className="rounded-full bg-surface-2 px-3 py-1"><bdi dir="ltr">{profile.email}</bdi></li>}
                {profile?.phone && <li className="rounded-full bg-surface-2 px-3 py-1"><bdi dir="ltr">{profile.phone}</bdi></li>}
                <li className="rounded-full bg-surface-2 px-3 py-1">{formatDate(locale, data.created_at, ZONE)}</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border bg-surface-2/40 px-6 py-5 lg:px-8">
            {open ? (
              <>
                <div aria-hidden className="mb-3 hidden sm:block"><LaneHeader stations={stations} /></div>
                <LaneTrack status={data.status} stations={stations.length} label={`${stations[at]}: ${ts(data.status)}`} />
                <p className="mt-3 text-sm font-semibold sm:hidden">{stations[at]}</p>
              </>
            ) : <p className="flex items-center gap-3 text-sm"><Badge tone={statusTone(data.status)}>{ts(data.status)}</Badge></p>}
          </div>
        </div>

        <aside aria-labelledby="decision" className="on-deep flex flex-col rounded-[var(--radius-panel)] bg-deep p-6 text-deep-foreground">
          <h2 id="decision" className="label-caps text-brand-gold!">{t('statusNow')}</h2>
          <p className="mt-2 font-display text-2xl font-bold">{ts(data.status)}</p>
          <div className="mt-4 [&_select]:bg-ivory [&_select]:text-forest">
            {canManage ? <ApplicantStatus id={data.id} status={data.status} label={t('statusLabel')} canReopen={canReopenApplications(data.my_role ?? undefined)} /> : null}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-deep-muted">{t('decisionsNote')}</p>
          <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-mint/15 pt-5 text-center">
            <div><dt className="text-[0.6875rem] text-deep-muted">{t('assessmentsTitle')}</dt><dd className="num font-display text-2xl font-bold">{n(data.assessment_attempts.length)}</dd></div>
            <div><dt className="text-[0.6875rem] text-deep-muted">{t('interviewsShort')}</dt><dd className="num font-display text-2xl font-bold">{n(data.interviews.length)}</dd></div>
            <div><dt className="text-[0.6875rem] text-deep-muted">{t('notesShort')}</dt><dd className="num font-display text-2xl font-bold">{n(data.notes.length)}</dd></div>
          </dl>
        </aside>
      </header>

      <p className="flex gap-2 text-sm text-muted"><Icon name="shield" className="mt-0.5 size-4 shrink-0 text-primary" />{t('snapshotNote', { date: data.captured_at ? formatDate(locale, data.captured_at, ZONE) : '—' })}</p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {data.cover_note && (
            <Panel id="cover" title={t('coverNote')}>
              <blockquote className="border-s-4 border-gold ps-4 text-lg leading-relaxed whitespace-pre-line"><bdi>{data.cover_note}</bdi></blockquote>
            </Panel>
          )}

          <Panel id="relevance" title={t('relevanceTitle')} lead={t('relevanceNote')}>
            {data.relevance.total === 0 ? <p className="text-muted">{t('relevanceNone')}</p> : (
              <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
                <p className="text-center md:text-start">
                  <span className="num font-display text-5xl font-bold">{n(data.relevance.matched.length)}</span>
                  <span className="num font-display text-2xl text-muted"> / {n(data.relevance.total)}</span>
                  <span className="mt-1 block text-sm text-muted">{t('relevanceCount', { matched: n(data.relevance.matched.length), total: n(data.relevance.total) })}</span>
                </p>
                <div>
                  <span aria-hidden className="flex h-3 overflow-hidden rounded-full bg-surface-2">
                    <span style={{ width: `${(assessed / data.relevance.total) * 100}%` }} className="bg-[var(--brand-deep)] dark:bg-mint" />
                    <span style={{ width: `${(listed / data.relevance.total) * 100}%` }} className="bg-[var(--brand-mint)]" />
                  </span>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {data.relevance.matched.map((s) => (
                      <li key={s.id} className={clsx('rounded-full px-3 py-1 text-sm', s.evidence === 'assessed' ? 'bg-[var(--brand-deep)] font-medium text-ivory dark:bg-mint dark:text-forest' : 'bg-[color-mix(in_srgb,var(--brand-mint)_45%,transparent)] text-forest dark:text-mint')}>
                        {name(s)} · {t(`evidence.${s.evidence}`)}
                      </li>
                    ))}
                    {data.relevance.gaps.map((s) => <li key={s.id} className="rounded-full border border-dashed border-border-strong px-3 py-1 text-sm text-muted">{name(s)}</li>)}
                  </ul>
                  {data.relevance.gaps.length > 0 && <p className="mt-3 text-xs text-muted">{t('relevanceGaps')}: {data.relevance.gaps.map(name).join(sep)}</p>}
                </div>
              </div>
            )}
          </Panel>

          <Panel id="requirements-match" title={tm('title')} lead={tm('lead')}>
            {match ? <RequirementMatch orgId={orgId} applicationId={applicationId} data={match} canReview={canReview} /> : <p role="alert" className="text-sm text-muted">{tm('unavailable')}</p>}
          </Panel>

          <Panel id="assessments" flush title={t('assessmentsTitle')} count={n(data.assessment_attempts.length)}>
            {data.assessment_attempts.length === 0 ? <p className="px-6 py-8 text-muted lg:px-8">{t('assessmentsNone')}</p> : (
              <ul className="divide-y divide-border">
                {data.assessment_attempts.map((a) => {
                  const e = a.evaluation_results;
                  return (
                    <li key={a.id} className="space-y-5 px-6 py-6 lg:px-8">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-lg font-bold">{pick(locale, a.assessment_versions.assessments.title_ar, a.assessment_versions.assessments.title_en)}</p>
                          <p className="text-sm text-muted">{t('version', { number: a.assessment_versions.version_number })} · {t(`attempt.${a.status}`)}{a.submitted_at && ` · ${formatDate(locale, a.submitted_at, ZONE)}`}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          {e?.status === 'reviewed' && e.overall_score != null && (
                            <p className="text-end"><span className="num font-display text-3xl font-bold">{n(Number(e.overall_score))}</span><span className="block text-xs text-muted">{t('overallLabel')}</span></p>
                          )}
                          {a.status === 'submitted' && <Link href={`/organization/${orgId}/review/${a.id}`} className="btn btn-primary btn-sm">{t('openReview')}<Arrow /></Link>}
                        </div>
                      </div>
                      {!e && a.status === 'submitted' && <p className="text-sm">{t('notEvaluated')}</p>}
                      {e && (
                        <>
                          <p className="flex flex-wrap items-center gap-2 text-sm">
                            <span className={clsx('inline-flex items-center gap-1.5 font-semibold', e.status === 'reviewed' ? 'text-success' : 'text-gold-text')}><span aria-hidden className="size-1.5 rounded-full bg-current" />{t(`evaluation.${e.status}`)}</span>
                            {e.ai_mode === 'demo' && <span className="text-muted">· {t('demoMode')}</span>}
                            {e.status !== 'reviewed' && <span className="text-muted">· {t('proposalsOnly')}</span>}
                          </p>
                          {e.skill_scores.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-muted">{t('skillLevels')}</p>
                              <ul className="mt-2 flex flex-wrap gap-2">
                                {e.skill_scores.map((s) => <li key={s.skills.id} className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm">{name(s.skills)} <span className="num ms-1 font-display font-bold text-primary">L{s.level}</span></li>)}
                              </ul>
                            </div>
                          )}
                          {e.reference_skill_scores.length > 0 && (
                            <p className="text-sm"><span className="font-semibold">{tr('workbookSkills')}: </span>{e.reference_skill_scores.map((s) => `${s.reference_skills.name_ar} ${n(Number(s.score_pct))}%`).join('، ')}</p>
                          )}
                          {e.criterion_scores.length > 0 && (
                            <ul className="space-y-4">
                              {[...e.criterion_scores].sort((x, y) => x.rubric_criteria.code.localeCompare(y.rubric_criteria.code)).map((c) => {
                                const max = Number(c.rubric_criteria.max_score) || 1;
                                return (
                                  <li key={c.rubric_criteria.code} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6">
                                    <div>
                                      <p className="text-sm"><span className="num font-semibold text-gold-text">{c.rubric_criteria.code}</span> {pick(locale, c.rubric_criteria.description_ar, c.rubric_criteria.description_en)}</p>
                                      <p className="text-xs text-muted">{t(`source.${c.source}`)}</p>
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-3">
                                        <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(Number(c.score) / max) * 100}%` }} /></span>
                                        <span className="num w-14 shrink-0 text-end text-sm font-semibold">{n(Number(c.score))} / {n(max)}</span>
                                      </div>
                                      {(c.evidence_ref || c.explanation) && (
                                        <p className="mt-1.5 text-sm">{c.evidence_ref && <q className="me-2 italic"><bdi>{c.evidence_ref}</bdi></q>}{c.explanation && <span className="text-muted"><bdi>{c.explanation}</bdi></span>}</p>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {e.evaluation_reviews.filter((r) => r.notes).map((r, i) => (
                            <p key={i} className="rounded-[var(--radius-control)] bg-surface-2/60 p-3 text-sm"><span className="font-semibold">{t('assessorNote')}: </span><bdi>{r.notes}</bdi></p>
                          ))}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel id="profile" title={t('profileTitle')} action={data.has_cv ? <ApplicantCvButton applicationId={applicationId} /> : <span className="text-sm text-muted">{t('cvNone')}</span>}>
            {profile?.summary && <p className="max-w-3xl leading-relaxed whitespace-pre-line"><bdi>{profile.summary}</bdi></p>}
            <div className={clsx(profile?.summary && 'mt-6')}>
              <h3 className="text-xs font-semibold text-muted">{t('skills')}</h3>
              <p className="text-xs text-muted">{t('skillsNote')}</p>
              {data.skills.listed.length + data.skills.reference.length + (profile?.self_reported_skills?.length ?? 0) === 0 ? <p className="mt-2 text-sm text-muted">{t('none')}</p> : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {data.skills.reference.map((s) => <li key={s.id} className="rounded-full border border-border px-3 py-1 text-sm">{s.name_ar}</li>)}
                  {data.skills.listed.map((s) => <li key={s.id} className="rounded-full bg-[color-mix(in_srgb,var(--brand-mint)_45%,transparent)] px-3 py-1 text-sm text-forest dark:text-mint">{name(s)}</li>)}
                  {profile?.self_reported_skills?.map((s) => <li key={s} className="rounded-full border border-dashed border-border-strong px-3 py-1 text-sm"><bdi>{s}</bdi></li>)}
                </ul>
              )}
            </div>
            <div className="mt-8 grid gap-x-10 gap-y-7 md:grid-cols-2">
              <div><h3 className="text-xs font-semibold text-muted">{t('experience')}</h3>{list(profile?.experience, (e) => [e.title, e.organization].filter(Boolean).join(' · '), span)}</div>
              <div><h3 className="text-xs font-semibold text-muted">{t('education')}</h3>{list(profile?.education, (e) => [e.qualification, e.field].filter(Boolean).join(' · '), (e) => [e.institution, span(e)].filter(Boolean).join(' · '))}</div>
              <div><h3 className="text-xs font-semibold text-muted">{t('projects')}</h3>{list(profile?.projects, (e) => e.title ?? '')}</div>
              <div><h3 className="text-xs font-semibold text-muted">{t('certifications')}</h3>{list([...(profile?.certifications ?? []), ...(profile?.courses ?? [])], (e) => e.title ?? '')}</div>
              <div><h3 className="text-xs font-semibold text-muted">{t('achievements')}</h3>{list(profile?.achievements, (e) => e.title ?? '')}</div>
              <div><h3 className="text-xs font-semibold text-muted">{t('languages')}</h3>{list((profile?.languages ?? []).map((l) => ({ title: [l.name, l.level].filter(Boolean).join(' · ') })), (e) => e.title ?? '')}</div>
            </div>
          </Panel>

          <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-6 lg:p-8">
            <HiringPanel orgId={orgId} applicationId={applicationId} interviews={data.interviews} outcomes={data.hiring_outcomes} canManage={canManage} status={data.status}
              team={data.team.filter((m) => m.user_id !== data.my_user_id)} />
          </div>

          {data.interviews.length > 0 && (
            <Panel id="feedback" title={t('feedbackTitle')} lead={t('feedbackNote')}>
              <ul className="space-y-8">
                {data.interviews.map((i) => (
                  <li key={i.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                    <p className="font-semibold">{formatWhen(locale, i.scheduled_at, i.time_zone)}</p>
                    <p className="text-sm text-muted">{t('participants')}: {i.participants.map(who).join(sep)}</p>
                    <InterviewPreparation orgId={orgId} interviewId={i.id} prep={preparations.get(i.id) ?? null} canPrepare={i.status !== 'cancelled'} />
                    <InterviewFeedback
                      orgId={orgId} applicationId={applicationId} interviewId={i.id}
                      canWrite={i.participants.some((p) => p?.user_id === data.my_user_id) && i.status !== 'cancelled'}
                      mine={i.feedback.find((f) => f.author_id === data.my_user_id) ?? null}
                      submitted={i.feedback.filter((f) => f.status === 'submitted').map((f) => ({ ...f, authorName: who(f.author) }))}
                      suggested={formLabels(preparations.get(i.id) ?? null, locale).length ? formLabels(preparations.get(i.id) ?? null, locale) : [...data.relevance.matched, ...data.relevance.gaps].map(name)}
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-28 xl:self-start">
          <section aria-labelledby="history" className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <h2 id="history" className="mb-4 font-display text-lg font-bold">{t('historyTitle')}</h2>
            <Timeline label={t('historyTitle')} items={data.application_status_history.map((h) => ({ key: h.id, title: ts(h.to_status), when: <>{formatDate(locale, h.created_at, ZONE)}{h.changed_by && ` · ${who(h.changed_by)}`}</> }))} />
          </section>
          <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <ApplicationNotes orgId={orgId} applicationId={applicationId} notes={data.notes.map((nt) => ({ ...nt, authorName: who(nt.author) }))} />
          </div>
        </aside>
      </div>
    </article>
  );
}
