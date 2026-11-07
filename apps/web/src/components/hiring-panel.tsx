'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { issueOutcome, retryInterviewCalendar, scheduleInterview, updateInterview } from '@/lib/candidate-actions';
import { formatWhen, pick } from '@/lib/format';
import { ErrorText, Field, INPUT, PRIMARY, useAction } from './forms';

type Interview = { id: string; scheduled_at: string; duration_minutes: number; time_zone: string; status: string; calendar_status: string; reschedule_note: string | null };
type Outcome = { id: string; outcome: string; message_ar: string | null; message_en: string | null; issued_at: string };

function InterviewRow({ orgId, interview, canManage }: { orgId: string; interview: Interview; canManage: boolean }) {
  const t = useTranslations('hiring');
  const ta = useTranslations('application');
  const ti = useTranslations('interview');
  const locale = useLocale();
  const [when, setWhen] = useState('');
  const move = useAction(() => updateInterview(orgId, interview.id, { scheduled_at: new Date(when).toISOString() }));
  const cancel = useAction(() => updateInterview(orgId, interview.id, { status: 'cancelled' }));
  const complete = useAction(() => updateInterview(orgId, interview.id, { status: 'completed' }));
  const absent = useAction(() => updateInterview(orgId, interview.id, { status: 'no_show' }));
  const retry = useAction(() => retryInterviewCalendar(orgId, interview.id));
  const live = ['invited', 'accepted', 'reschedule_requested'].includes(interview.status);
  return (
    <li className="space-y-2 border-b border-border py-4">
      <p className="font-semibold">{formatWhen(locale, interview.scheduled_at, interview.time_zone)} · {ta(`interviewStatus.${interview.status}`)}</p>
      <p className="text-sm text-muted">{ti(`calendarStatus.${interview.calendar_status}`)}</p>
      {interview.reschedule_note && <p className="border-s-2 border-gold ps-3 text-sm">{t('candidateNote', { note: interview.reschedule_note })}</p>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link href={`/interviews/${interview.id}`} className="font-semibold text-primary underline underline-offset-4">{t('open')}</Link>
        {canManage && interview.calendar_status === 'failed' && <button type="button" onClick={retry.fire} disabled={retry.pending} className="font-semibold underline underline-offset-4">{t('retryCalendar')}</button>}
        {canManage && live && (
          <>
            <button type="button" onClick={complete.fire} disabled={complete.pending} className="font-semibold underline underline-offset-4">{t('markCompleted')}</button>
            <button type="button" onClick={absent.fire} disabled={absent.pending} className="font-semibold underline underline-offset-4">{t('markNoShow')}</button>
            <button type="button" onClick={cancel.fire} disabled={cancel.pending} className="text-muted underline underline-offset-4">{t('cancel')}</button>
          </>
        )}
      </div>
      {canManage && live && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); move.fire(); }}>
          <label className="block">
            <span className="text-sm font-medium">{t('newTime')}</span>
            <input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} className={INPUT} />
          </label>
          <button type="submit" disabled={move.pending} className="rounded-full border border-foreground/30 px-4 py-2.5 text-sm font-semibold">{t('reschedule')}</button>
        </form>
      )}
      <ErrorText code={move.error ?? cancel.error ?? complete.error ?? absent.error ?? retry.error} />
    </li>
  );
}

/** What the candidate journey needs from the organization side: scheduling a person-to-person interview and issuing a decision. */
type Member = { user_id: string; email: string | null; display_name: string | null };

export function HiringPanel({ orgId, applicationId, interviews, outcomes, canManage, status, team = [] }: {
  orgId: string; applicationId: string; interviews: Interview[]; outcomes: Outcome[]; canManage: boolean; status: string;
  /** Members who can be added as interviewers. Whoever schedules always takes part. */
  team?: Member[];
}) {
  const t = useTranslations('hiring');
  const ta = useTranslations('application');
  const locale = useLocale();
  const [scheduling, startSchedule] = useTransition();
  const [scheduleError, setScheduleError] = useState<string>();
  const [issuing, startIssue] = useTransition();
  const [issueError, setIssueError] = useState<string>();
  const trimmed = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

  // Read from the form itself, so what was typed before the page finished loading still counts.
  function schedule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    const form = new FormData(target);
    const when = new Date(trimmed(form, 'when'));
    if (Number.isNaN(when.getTime())) return setScheduleError('required');
    startSchedule(async () => {
      const result = await scheduleInterview(orgId, applicationId, {
        scheduled_at: when.toISOString(), duration_minutes: Number(trimmed(form, 'duration')), time_zone: 'Asia/Riyadh',
        interviewer_ids: form.getAll('interviewer').map(String),
        ...(trimmed(form, 'instructions_ar') && { instructions_ar: trimmed(form, 'instructions_ar') }),
        ...(trimmed(form, 'instructions_en') && { instructions_en: trimmed(form, 'instructions_en') }),
      });
      setScheduleError(result.error);
      if (result.ok) target.reset();
    });
  }
  function issue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    const form = new FormData(target);
    startIssue(async () => {
      const result = await issueOutcome(orgId, applicationId, {
        outcome: trimmed(form, 'outcome'),
        ...(trimmed(form, 'message_ar') && { message_ar: trimmed(form, 'message_ar') }),
        ...(trimmed(form, 'message_en') && { message_en: trimmed(form, 'message_en') }),
      });
      setIssueError(result.error);
      if (result.ok) target.reset();
    });
  }
  return (
    <div className="space-y-10">
      <section aria-labelledby="hiring-interviews">
        <h2 id="hiring-interviews" className="section-title">{t('interviews')}</h2>
        {interviews.length > 0 && <ul className="mt-2 border-t border-border">{interviews.map((i) => <InterviewRow key={i.id} orgId={orgId} interview={i} canManage={canManage} />)}</ul>}
        {canManage && (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={schedule}>
            <label className="block"><span className="text-sm font-medium">{t('when')}</span><input type="datetime-local" name="when" required className={INPUT} /></label>
            <Field name="duration" type="number" min={5} max={480} required label={t('duration')} defaultValue="30" />
            <Field name="instructions_ar" dir="rtl" maxLength={2000} label={t('instructionsAr')} />
            <Field name="instructions_en" dir="ltr" maxLength={2000} label={t('instructionsEn')} />
            {team.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">{t('interviewers')}</legend>
                <p className="text-sm text-muted">{t('interviewersNote')}</p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {team.map((m) => (
                    <label key={m.user_id} className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" name="interviewer" value={m.user_id} className="size-4 accent-[var(--primary)]" />
                      <bdi>{m.display_name || m.email}</bdi>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="sm:col-span-2"><ErrorText code={scheduleError} /><button type="submit" disabled={scheduling} aria-busy={scheduling} className={PRIMARY}>{t('schedule')}</button></div>
          </form>
        )}
      </section>
      <section aria-labelledby="hiring-outcome">
        <h2 id="hiring-outcome" className="section-title">{t('outcome')}</h2>
        <p className="mt-1 text-sm text-muted">{t('outcomeNote')}</p>
        {canManage && !['hired', 'shortlisted'].includes(status) && <p className="mt-1 text-sm text-muted">{t('hireNeedsShortlist')}</p>}
        {outcomes.length > 0 && (
          <ul className="mt-2 space-y-1">{outcomes.map((o) => <li key={o.id} className="text-sm"><span className="font-semibold">{ta(`outcome.${o.outcome}`)}</span> · {pick(locale, o.message_ar ?? '', o.message_en ?? '')}</li>)}</ul>
        )}
        {/* The database refuses another outcome once the candidate is hired. */}
        {canManage && status !== 'hired' && (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={issue}>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">{t('decision')}</span>
              <select name="outcome" required defaultValue="" className={INPUT}>
                <option value="">{t('choose')}</option>
                {(status === 'shortlisted' ? ['hired', 'not_selected', 'on_hold', 'additional_interview'] : ['not_selected', 'on_hold', 'additional_interview']).map((k) => <option key={k} value={k}>{ta(`outcome.${k}`)}</option>)}
              </select>
            </label>
            <Field name="message_ar" dir="rtl" maxLength={2000} label={t('messageAr')} />
            <Field name="message_en" dir="ltr" maxLength={2000} label={t('messageEn')} />
            <div className="sm:col-span-2"><ErrorText code={issueError} /><button type="submit" disabled={issuing} aria-busy={issuing} className={PRIMARY}>{t('issue')}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
