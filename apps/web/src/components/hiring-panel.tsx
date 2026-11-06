'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
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
export function HiringPanel({ orgId, applicationId, interviews, outcomes, canManage }: { orgId: string; applicationId: string; interviews: Interview[]; outcomes: Outcome[]; canManage: boolean }) {
  const t = useTranslations('hiring');
  const ta = useTranslations('application');
  const locale = useLocale();
  const [when, setWhen] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [instructions, setInstructions] = useState({ ar: '', en: '' });
  const [outcome, setOutcome] = useState('');
  const [message, setMessage] = useState({ ar: '', en: '' });
  const zone = 'Asia/Riyadh';
  const schedule = useAction(async () => {
    const result = await scheduleInterview(orgId, applicationId, {
      scheduled_at: new Date(when).toISOString(), duration_minutes: Number(minutes), time_zone: zone,
      ...(instructions.ar.trim() && { instructions_ar: instructions.ar.trim() }), ...(instructions.en.trim() && { instructions_en: instructions.en.trim() }),
    });
    if (result.ok) setWhen('');
    return result;
  });
  const issue = useAction(async () => {
    const result = await issueOutcome(orgId, applicationId, { outcome, ...(message.ar.trim() && { message_ar: message.ar.trim() }), ...(message.en.trim() && { message_en: message.en.trim() }) });
    if (result.ok) setOutcome('');
    return result;
  });
  return (
    <div className="space-y-10">
      <section aria-labelledby="hiring-interviews">
        <h2 id="hiring-interviews" className="font-display text-2xl font-bold">{t('interviews')}</h2>
        {interviews.length > 0 && <ul className="mt-2 border-t border-border">{interviews.map((i) => <InterviewRow key={i.id} orgId={orgId} interview={i} canManage={canManage} />)}</ul>}
        {canManage && (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); schedule.fire(); }}>
            <label className="block"><span className="text-sm font-medium">{t('when')}</span><input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} className={INPUT} /></label>
            <Field name="duration" type="number" min={5} max={480} required label={t('duration')} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            <Field name="instructions_ar" dir="rtl" maxLength={2000} label={t('instructionsAr')} value={instructions.ar} onChange={(e) => setInstructions({ ...instructions, ar: e.target.value })} />
            <Field name="instructions_en" dir="ltr" maxLength={2000} label={t('instructionsEn')} value={instructions.en} onChange={(e) => setInstructions({ ...instructions, en: e.target.value })} />
            <div className="sm:col-span-2"><ErrorText code={schedule.error} /><button type="submit" disabled={schedule.pending} aria-busy={schedule.pending} className={PRIMARY}>{t('schedule')}</button></div>
          </form>
        )}
      </section>
      <section aria-labelledby="hiring-outcome">
        <h2 id="hiring-outcome" className="font-display text-2xl font-bold">{t('outcome')}</h2>
        <p className="mt-1 text-sm text-muted">{t('outcomeNote')}</p>
        {outcomes.length > 0 && (
          <ul className="mt-2 space-y-1">{outcomes.map((o) => <li key={o.id} className="text-sm"><span className="font-semibold">{ta(`outcome.${o.outcome}`)}</span> · {pick(locale, o.message_ar ?? '', o.message_en ?? '')}</li>)}</ul>
        )}
        {canManage && (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); issue.fire(); }}>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">{t('decision')}</span>
              <select required value={outcome} onChange={(e) => setOutcome(e.target.value)} className={INPUT}>
                <option value="">{t('choose')}</option>
                {['hired', 'not_selected', 'on_hold', 'additional_interview'].map((k) => <option key={k} value={k}>{ta(`outcome.${k}`)}</option>)}
              </select>
            </label>
            <Field name="message_ar" dir="rtl" maxLength={2000} label={t('messageAr')} value={message.ar} onChange={(e) => setMessage({ ...message, ar: e.target.value })} />
            <Field name="message_en" dir="ltr" maxLength={2000} label={t('messageEn')} value={message.en} onChange={(e) => setMessage({ ...message, en: e.target.value })} />
            <div className="sm:col-span-2"><ErrorText code={issue.error} /><button type="submit" disabled={issue.pending} aria-busy={issue.pending} className={PRIMARY}>{t('issue')}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
