'use client';

import clsx from 'clsx';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { number } from '@/lib/format';
import { Logo } from '../brand';
import { Icon } from '../icons';

/**
 * Glimpses of the product at each destination. They are illustrations, not live data: the organizations are fictional
 * and every panel says so. They mirror real MIDAN screens (opportunities, skills and match, the assessment workspace,
 * interview scheduling) so a visitor sees what the platform actually does.
 */

type Previews = {
  illustrative: string;
  discover: { title: string; filter: string; match: string; items: { role: string; org: string; city: string; skills: string[] }[] };
  assessment: { title: string; task: string; skillsLabel: string; skills: string[]; checklist: string[]; file: string; uploading: string; deadline: string; step: string };
  interview: { title: string; role: string; day: string; time: string; mode: string; status: string; weekdays: string[]; dates: number[]; selected: number };
};

function Frame({ children, title, icon, className }: { children: React.ReactNode; title: string; icon: Parameters<typeof Icon>[0]['name']; className?: string }) {
  const t = useTranslations('journey.previews');
  return (
    <div className={clsx('overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface/95 shadow-[var(--shadow)] backdrop-blur', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold"><Icon name={icon} className="size-4 text-primary" />{title}</span>
        <span className="rounded-[3px] bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted">{t('illustrative')}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const MONO = ['bg-forest text-ivory', 'bg-brand-gold text-forest', 'bg-mint text-forest'];

export function DiscoverPreview() {
  const p = (useMessages() as unknown as { journey: { previews: Previews } }).journey.previews.discover;
  return (
    <Frame title={p.title} icon="briefcase">
      <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-muted">
        <Icon name="search" className="size-4" />{p.filter}
      </div>
      <ul className="divide-y divide-border">
        {p.items.map((job, i) => (
          <li key={job.role} className="flex items-start gap-3 py-2.5">
            <span aria-hidden className={clsx('grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] font-display text-sm font-bold', MONO[i % 3])}>{job.org.charAt(0)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{job.role}</span>
              <span className="block truncate text-xs text-muted">{job.org} · {job.city}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {job.skills.map((s) => <span key={s} className="rounded-[3px] bg-accent px-1.5 py-0.5 text-[0.6875rem] font-medium text-accent-foreground">{s}</span>)}
              </span>
            </span>
            {i === 0 && <span className="shrink-0 rounded-[3px] border border-gold px-1.5 py-0.5 text-[0.6875rem] font-semibold text-gold-text">{p.match}</span>}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function AssessmentPreview() {
  const p = (useMessages() as unknown as { journey: { previews: Previews } }).journey.previews.assessment;
  return (
    <Frame title={p.title} icon="file">
      <p className="text-sm leading-snug font-semibold">{p.task}</p>
      <p className="mt-2 flex flex-wrap items-center gap-1 text-[0.6875rem] text-muted">
        {p.skillsLabel}
        {p.skills.map((sk) => <span key={sk} className="rounded-[3px] bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">{sk}</span>)}
      </p>
      <ul className="mt-3 space-y-2">
        {p.checklist.map((item, i) => (
          <li key={item} className="flex items-start gap-2 text-sm">
            <span aria-hidden className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border', i < 2 ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong')}>
              {i < 2 && <Icon name="check" className="size-3" />}
            </span>
            <span className={clsx(i < 2 && 'text-muted line-through decoration-1')}>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-[var(--radius-control)] border border-border bg-background p-3">
        <span className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium"><Icon name="file" className="size-3.5" /><bdi>{p.file}</bdi></span>
          <span className="text-muted">{p.uploading}</span>
        </span>
        <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-2"><span className="journey-upload block h-full w-[72%] rounded-full bg-gold" /></span>
      </div>
      <p className="mt-3 flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1.5"><Icon name="clock" className="size-3.5" />{p.deadline}</span>
        <span>{p.step}</span>
      </p>
    </Frame>
  );
}

export function InterviewPreview() {
  const p = (useMessages() as unknown as { journey: { previews: Previews } }).journey.previews.interview;
  const locale = useLocale();
  return (
    <Frame title={p.title} icon="calendar">
      <p className="text-xs text-muted">{p.role}</p>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {p.weekdays.map((d, i) => (
          <span key={`${d}-${i}`} className="text-[0.6875rem] text-muted">{d}</span>
        ))}
        {p.dates.map((d) => (
          <span key={d} className={clsx('num grid h-8 place-items-center rounded-[3px] text-sm', d === p.selected ? 'bg-[var(--button)] font-bold text-[var(--button-foreground)]' : 'bg-background')}>{number(locale, d)}</span>
        ))}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-border pt-3">
        <span>
          <span className="block text-sm font-semibold">{p.day}</span>
          <span className="block text-xs text-muted">{p.time} · {p.mode}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-success-surface px-2 py-1 text-xs font-semibold text-success"><Icon name="check" className="size-3.5" />{p.status}</span>
      </div>
    </Frame>
  );
}

export function ChapterPreview() {
  const t = useTranslations('journey');
  return (
    <div className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-border bg-surface/95 p-4 shadow-[var(--shadow)] backdrop-blur">
      <span className="shrink-0"><Logo decorative className="h-12" sizes="96px" /></span>
      <ol className="grid flex-1 grid-cols-5 gap-1">
        {[t('arrival'), ...(t.raw('stages') as { short: string }[]).map((s) => s.short)].map((label, i) => (
          <li key={label} className="min-w-0">
            <span aria-hidden className={clsx('block h-1 rounded-full', i < 4 ? 'bg-primary' : 'bg-gold')} />
            <span className="mt-1.5 block truncate text-[0.6875rem] text-muted">{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const PREVIEWS = [DiscoverPreview, AssessmentPreview, InterviewPreview, ChapterPreview];
