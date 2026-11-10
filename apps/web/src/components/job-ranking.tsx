import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { number, pick } from '@/lib/format';

type Line = { key: string; text_ar: string | null; text_en: string | null; mandatory: boolean };
type Cv =
  | { status: 'scored'; score: number | null; counts: Record<string, number>; reviewed: number; strengths: Line[]; partial: Line[]; gaps: Line[] }
  | { status: 'unavailable' | 'no_requirements' };
export type Ranking = {
  sort: 'cv' | 'assessment' | 'interview';
  overall: { available: boolean; reason: string };
  requirements: number;
  applicants: {
    application_id: string; status: string; name: string | null; headline: string | null; rank: number | null;
    cv: Cv;
    assessments: { assessment_id: string; title_ar: string; title_en: string; state: string; score: number | null }[];
    assessment_score: number | null;
    interview: { state: string; forms: number; average_rating: number | null; recommendations: Record<string, number> };
    matching: { provider: string | null; model_version: string | null; fallback: string | null } | null;
  }[];
};

/**
 * Every applicant to the job, ranked by the stage the employer chooses. Stage scores stay separate: no approved rule
 * combines them, so there is no overall percentage, and the screen says why. Pending stages are shown as pending.
 */
export async function JobRanking({ locale, orgId, jobId, data }: { locale: string; orgId: string; jobId: string; data: Ranking }) {
  const t = await getTranslations({ locale, namespace: 'ranking' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });
  const text = (l: Line) => pick(locale, l.text_ar ?? l.text_en ?? '', l.text_en ?? l.text_ar ?? '');
  // The backend each match used, as the AI service recorded it: word comparison (configured or a fallback) is named as such.
  const providers = [...new Set(data.applicants.map((a) => a.matching && (a.matching.fallback || a.matching.provider === 'lexical' ? 'fallback' : a.matching.model_version)).filter(Boolean))] as string[];
  return (
    <div>
      <p className="text-sm text-muted">{t('lead')}</p>
      {/* How the CV percentage is calculated, so the employer can see why one applicant is above another. */}
      <p className="mt-2 text-sm text-muted">{t('cvRule')}</p>
      <p className="mt-2 text-sm text-muted">{t('noOverall')}</p>
      {providers.length > 0 && (
        <p className="mt-2 text-xs text-muted">{t('matchedWith', { model: providers.map((p) => (p === 'fallback' ? t('fallback') : p)).join(', ') })}</p>
      )}
      <nav aria-label={t('sortLabel')} className="mt-4 flex flex-wrap gap-2 text-sm">
        {(['cv', 'assessment', 'interview'] as const).map((key) => (
          <Link key={key} href={`/organization/${orgId}/jobs/${jobId}?rank=${key}#ranking`} aria-current={data.sort === key ? 'true' : undefined}
            className={data.sort === key ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>{t(`sort.${key}`)}</Link>
        ))}
      </nav>
      {data.applicants.length === 0 ? (
        <p className="mt-4 text-muted">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-border text-start">
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('rank')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{t('candidate')}</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold">{t('cv')}</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold">{t('assessment')}</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold">{t('interview')}</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold">{t('strengthsGaps')}</th>
                <th scope="col" className="ps-2 py-2 text-start font-semibold">{t('stage')}</th>
              </tr>
            </thead>
            <tbody>
              {data.applicants.map((a) => (
                <tr key={a.application_id} className="border-b border-border align-top">
                  <td className="py-2.5 pe-3 font-semibold">{a.rank === null ? <span className="text-muted">{t('pending')}</span> : number(locale, a.rank)}</td>
                  <th scope="row" className="py-2.5 pe-3 text-start font-medium">
                    <Link href={`/organization/${orgId}/applicants/${a.application_id}`} className="link">{a.name || t('unnamed')}</Link>
                    {a.headline && <span className="block text-xs font-normal text-muted">{a.headline}</span>}
                  </th>
                  <td className="px-2 py-2.5">
                    {a.cv.status === 'scored' ? (
                      <>
                        <span className="font-semibold">{a.cv.score === null ? t('needsReview') : `${number(locale, a.cv.score)}%`}</span>
                        <span className="block text-xs text-muted">{t('cvBreakdown', { matched: number(locale, a.cv.counts.matched), partial: number(locale, a.cv.counts.partial), missing: number(locale, a.cv.counts.missing), review: number(locale, a.cv.counts.needs_review) })}</span>
                      </>
                    ) : (
                      <span className="text-muted">
                        {t(`cvState.${a.cv.status}`)}
                        {/* The analysis runs on every read: asking again is simply reading the ranking again. */}
                        {a.cv.status === 'unavailable' && <Link href={`/organization/${orgId}/jobs/${jobId}?rank=${data.sort}#ranking`} className="link ms-2 text-xs">{t('retry')}</Link>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {a.assessments.length === 0 ? <span className="text-muted">{t('noAssessment')}</span> : a.assessments.map((s) => (
                      <span key={s.assessment_id} className="block">
                        {a.assessments.length > 1 && <span className="text-xs text-muted">{pick(locale, s.title_ar, s.title_en)}: </span>}
                        {s.score !== null ? <span className="font-semibold">{number(locale, s.score)}%</span> : <span className="text-muted">{t(`assessmentState.${s.state}`)}</span>}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-2.5">
                    {a.interview.average_rating !== null
                      ? <><span className="font-semibold">{t('rating', { value: number(locale, a.interview.average_rating) })}</span><span className="block text-xs text-muted">{t('forms', { n: a.interview.forms })}</span></>
                      : <span className="text-muted">{t(`interviewState.${a.interview.state}`)}</span>}
                  </td>
                  <td className="max-w-xs px-2 py-2.5 text-xs">
                    {a.cv.status === 'scored' && (
                      <>
                        {a.cv.strengths.length > 0 && <p><span className="font-semibold text-success">{t('strengths')}:</span> {a.cv.strengths.slice(0, 3).map(text).join(locale === 'ar' ? '، ' : '; ')}{a.cv.strengths.length > 3 && ` +${a.cv.strengths.length - 3}`}</p>}
                        {a.cv.gaps.length > 0 && <p className="mt-1"><span className="font-semibold">{t('gaps')}:</span> {a.cv.gaps.slice(0, 3).map(text).join(locale === 'ar' ? '، ' : '; ')}{a.cv.gaps.length > 3 && ` +${a.cv.gaps.length - 3}`}</p>}
                      </>
                    )}
                  </td>
                  <td className="ps-2 py-2.5">{ts(a.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t('manual')}</p>
    </div>
  );
}
