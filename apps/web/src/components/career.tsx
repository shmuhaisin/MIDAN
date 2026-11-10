import clsx from 'clsx';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { Career, RoleSkill } from '@/lib/career';
import { familyHref } from '@/lib/career';
import { number } from '@/lib/format';
import { Arrow } from './brand';
import { JourneyRoad } from './journey-track';

/**
 * The career journey's server-rendered pieces. Every number is a count of the candidate's own records; nothing here
 * estimates readiness. Copy lives under the `career` namespace.
 */

/** The destination: the role the candidate chose, on the deep surface, with the road of what's been recorded so far. */
export async function Destination({ locale, career, stations }: { locale: string; career: Career; stations: boolean[] }) {
  const t = await getTranslations({ locale, namespace: 'career' });
  const ts = await getTranslations({ locale, namespace: 'sectors' });
  const target = career.target;
  const family = target?.job_family_ar;
  return (
    <section aria-labelledby="destination" className="on-deep deep-grain relative overflow-hidden rounded-[var(--radius-panel)] bg-deep text-deep-foreground">
      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-10">
        <div className="min-w-0">
          <p className="label-caps text-gold">{t('destination.eyebrow')}</p>
          <h2 id="destination" className="display-lg mt-3 text-balance text-ivory">
            {target?.job_title ? <bdi>{target.job_title}</bdi> : family ? <bdi>{family}</bdi> : t('destination.none')}
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-deep-muted">
            {family && target?.sector_code
              ? t('destination.family', { family, sector: ts(target.sector_code) })
              : target?.job_title ? t('destination.titleOnly') : t('destination.noneLead')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {family && target?.sector_code && <Link href={familyHref(target.sector_code, family)} className="btn btn-outline-light btn-sm">{t('destination.details')}</Link>}
          <Link href="/development/roles" className="btn btn-gold btn-sm">{target ? t('destination.change') : t('destination.choose')}<Arrow /></Link>
        </div>
      </div>
      <div className="border-t border-mint/15 px-6 pt-6 pb-7 sm:px-8 lg:px-10">
        <JourneyRoad deep label={t('road.label')} steps={t.raw('road.steps') as string[]} done={stations} />
      </div>
    </section>
  );
}

/**
 * The role's skills by the evidence behind them, as one bar and its legend. Released assessment results are shown beside
 * it, never folded in: they name a different skills catalogue.
 */
export async function EvidenceSummary({ locale, career }: { locale: string; career: Career }) {
  const t = await getTranslations({ locale, namespace: 'career' });
  const n = (v: number) => number(locale, v);
  const listed = career.role_skills.filter((s) => s.evidence === 'self_reported').length;
  const open = career.role_skills.length - listed;
  const total = career.role_skills.length;
  const segments = [
    { key: 'listed', value: listed, className: 'bg-primary' },
    { key: 'open', value: open, className: 'bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_2px,transparent_2px_7px)]' },
  ];
  return (
    <div>
      {total > 0 ? (
        <>
          <div role="img" aria-label={t('evidence.aria', { listed: n(listed), open: n(open), total: n(total) })} className="flex h-3 overflow-hidden rounded-full border border-border bg-surface-2">
            {segments.map((s) => s.value > 0 && <span key={s.key} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} />)}
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <Count label={t('evidence.listed')} value={n(listed)} hint={t('evidence.listedHint')} swatch="bg-primary" />
            <Count label={t('evidence.open')} value={n(open)} hint={t('evidence.openHint')} swatch="border border-border-strong" />
            <Count label={t('evidence.shown')} value={n(career.demonstrated_strengths.length)} hint={t('evidence.shownHint')} swatch="bg-gold" />
          </dl>
        </>
      ) : <p className="text-sm text-muted">{t('evidence.noFamily')}</p>}
    </div>
  );
}

function Count({ label, value, hint, swatch }: { label: string; value: string; hint: string; swatch: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className={clsx('size-2.5 rotate-45', swatch)} />{label}</dt>
      <dd className="num mt-1 font-display text-3xl font-bold">{value}</dd>
      <dd className="mt-1 text-xs leading-relaxed text-muted">{hint}</dd>
    </div>
  );
}

/** One of the role's skills, with why it's listed and what can be done about it. */
export async function SkillLine({ locale, skill, index, children }: { locale: string; skill: RoleSkill; index?: number; children?: React.ReactNode }) {
  const t = await getTranslations({ locale, namespace: 'career' });
  return (
    <li className="grid gap-3 px-5 py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:px-6">
      {index !== undefined && <span aria-hidden className="num hidden font-display text-2xl font-bold text-gold-text sm:block">{number(locale, index + 1).padStart(2, '0')}</span>}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-display text-lg leading-snug font-bold">
          <bdi>{skill.name_ar}</bdi>
          {skill.is_priority && <span className="chip border-gold/50 bg-gold/10 text-xs text-gold-text">{t('skill.priority')}</span>}
          <span className={clsx('chip text-xs', skill.evidence === 'self_reported' ? 'border-primary/40 text-primary' : 'border-dashed text-muted')}>{t(`skill.evidence.${skill.evidence}`)}</span>
        </p>
        {skill.description_ar && <p dir="rtl" className="mt-1.5 text-sm leading-relaxed text-muted">{skill.description_ar}</p>}
        {children && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>}
      </div>
    </li>
  );
}

/** A labelled count with how many of it are done, as a small meter. */
export function Tally({ label, done, total, locale, href }: { label: string; done: number; total: number; locale: string; href?: string }) {
  const body = (
    <>
      <p className="text-sm font-semibold">{label}</p>
      <p className="num mt-2 font-display text-2xl font-bold">{number(locale, done)}<span className="text-base font-semibold text-muted"> / {number(locale, total)}</span></p>
      <span aria-hidden className="mt-3 block h-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-primary" style={{ width: total ? `${(done / total) * 100}%` : '0%' }} /></span>
    </>
  );
  return href
    ? <Link href={href} className="block rounded-[var(--radius-control)] border border-border bg-surface p-4 transition-colors hover:border-foreground/40">{body}</Link>
    : <div className="rounded-[var(--radius-control)] border border-border bg-surface p-4">{body}</div>;
}
