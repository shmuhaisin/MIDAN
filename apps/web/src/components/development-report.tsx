'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { draftDevelopmentReport, releaseDevelopmentReport } from '@/lib/candidate-actions';
import { formatDate, number } from '@/lib/format';
import { ErrorText } from './forms';

type Point = { text_ar: string; text_en: string };
type Line = { key: string; text_ar: string | null; text_en: string | null; mandatory: boolean };
export type ReportContent = {
  strengths: Point[]; development: Point[]; next_steps: Point[];
  evidence: { requirements: { shown: Line[]; not_shown: Line[] }; assessment: { criterion: string; description_ar: string; description_en: string; score: number; max: number }[]; interview: { label: string; average: number }[] };
};
export type StaffReport = { id: string; status: 'draft' | 'released'; content: ReportContent; created_at: string; released_at: string | null };

/** The report as the candidate reads it: the narrative, then the evidence it is built on. */
export function ReportBody({ content }: { content: ReportContent }) {
  const t = useTranslations('developmentReport');
  const locale = useLocale();
  const say = (p: Point) => (locale === 'ar' ? p.text_ar : p.text_en);
  const line = (l: Line) => (locale === 'ar' ? l.text_ar ?? l.text_en : l.text_en ?? l.text_ar) ?? '';
  const block = (title: string, points: Point[]) => points.length > 0 && (
    <div><h4 className="font-semibold">{title}</h4><ul className="mt-1 list-disc space-y-1 ps-5">{points.map((p, i) => <li key={i}>{say(p)}</li>)}</ul></div>
  );
  return (
    <div className="space-y-4 text-sm">
      {block(t('strengths'), content.strengths)}
      {block(t('development'), content.development)}
      {block(t('nextSteps'), content.next_steps)}
      <details className="rounded-[var(--radius-control)] border border-border p-3">
        <summary className="cursor-pointer font-semibold">{t('evidence')}</summary>
        <div className="mt-2 space-y-2 text-xs">
          {content.evidence.requirements.shown.length > 0 && <p><span className="font-semibold">{t('shown')}:</span> {content.evidence.requirements.shown.map(line).join('، ')}</p>}
          {content.evidence.requirements.not_shown.length > 0 && <p><span className="font-semibold">{t('notShown')}:</span> {content.evidence.requirements.not_shown.map(line).join('، ')}</p>}
          {content.evidence.assessment.length > 0 && <ul>{content.evidence.assessment.map((a, i) => <li key={i}>{locale === 'ar' ? a.description_ar : a.description_en}: {number(locale, a.score)} / {number(locale, a.max)}</li>)}</ul>}
          {content.evidence.interview.length > 0 && <ul>{content.evidence.interview.map((c, i) => <li key={i}><bdi>{c.label}</bdi>: {number(locale, c.average)} / {number(locale, 4)}</li>)}</ul>}
        </div>
      </details>
    </div>
  );
}

/** For the organization's staff: draft a report from the candidate's evidence, read it, then release it to them. */
export function DevelopmentReports({ orgId, applicationId, reports, canManage }: { orgId: string; applicationId: string; reports: StaffReport[]; canManage: boolean }) {
  const t = useTranslations('developmentReport');
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const latest = reports[0];
  const released = reports.find((r) => r.status === 'released');
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('staffNote')}</p>
      <ErrorText code={error} />
      {canManage && (
        <button type="button" disabled={pending} aria-busy={pending} className="btn btn-secondary btn-sm"
          onClick={() => start(async () => setError((await draftDevelopmentReport(orgId, applicationId)).error))}>{latest ? t('draftAgain') : t('draft')}</button>
      )}
      {!latest ? <p className="text-sm text-muted">{t('none')}</p> : (
        <div className="rounded-[var(--radius-panel)] border border-border bg-background p-4">
          <p className="mb-3 text-xs text-muted">
            {latest.status === 'released' ? t('releasedOn', { date: formatDate(locale, latest.released_at!, 'Asia/Riyadh') }) : t('draftOn', { date: formatDate(locale, latest.created_at, 'Asia/Riyadh') })}
          </p>
          <ReportBody content={latest.content} />
          {latest.status === 'draft' && canManage && (
            <button type="button" disabled={pending} aria-busy={pending} className="btn btn-primary btn-sm mt-4"
              onClick={() => start(async () => setError((await releaseDevelopmentReport(orgId, applicationId, latest.id)).error))}>{t('release')}</button>
          )}
        </div>
      )}
      {released && released !== latest && <p className="text-xs text-muted">{t('earlierReleased', { date: formatDate(locale, released.released_at!, 'Asia/Riyadh') })}</p>}
    </div>
  );
}
