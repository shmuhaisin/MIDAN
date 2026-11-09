'use client';

import clsx from 'clsx';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { number } from '@/lib/format';
import { Icon, type IconName } from './icons';

/** The candidate's seven places, in the order of their journey. */
const ITEMS: [string, string, IconName][] = [
  ['/dashboard', 'overview', 'home'],
  ['/development', 'development', 'growth'],
  ['/opportunities', 'jobs', 'briefcase'],
  ['/applications', 'applications', 'inbox'],
  ['/assessments', 'assessments', 'file'],
  ['/interviews', 'interviews', 'calendar'],
  ['/profile', 'profile', 'user'],
];
/** Pages that belong to a place without being its address. */
const OWNS: Record<string, string[]> = {
  '/opportunities': ['/opportunities', '/employers'],
  '/assessments': ['/assessments', '/reports'],
  '/profile': ['/profile'],
  '/dashboard': ['/dashboard', '/invitations'],
};
const TABS = ['/dashboard', '/development', '/opportunities', '/applications', '/profile'];
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The signed-in candidate's navigation, once per page: a bar under the header on wide screens, a tab bar at the thumb on
 * phones. Screens that need full attention (the assessment, onboarding) go without it.
 */
export function CandidateNav({ unread = 0 }: { unread?: number }) {
  const t = useTranslations('candidateNav');
  const locale = useLocale();
  const pathname = usePathname();
  if (pathname.startsWith('/experience') || pathname.startsWith('/onboarding') || pathname.startsWith('/organization') || pathname.startsWith('/admin')) return null;
  const isCurrent = (href: string) => (OWNS[href] ?? [href]).some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const count = unread > 0 ? (unread > 99 ? '99+' : number(locale, unread)) : null;

  return (
    <>
      <nav aria-label={t('label')} className="hidden border-b border-border bg-surface/60 lg:block">
        <div className="container-page flex items-center justify-between gap-4">
          <ul className="flex gap-1">
            {ITEMS.map(([href, key, icon]) => {
              const current = isCurrent(href);
              return (
                <li key={key}>
                  <Link
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={clsx('relative flex items-center gap-2 px-3.5 py-3 text-sm transition-colors', current ? 'font-semibold text-foreground' : 'text-muted hover:text-foreground')}
                  >
                    <Icon name={icon} className={clsx('size-[1.125rem]', current && 'text-primary')} />
                    {t(key)}
                    {current && <motion.span layoutId="candidate-current" aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 bg-gold" transition={{ duration: 0.35, ease: EASE }} />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <ul className="flex items-center gap-1">
            <li>
              <Link href="/assistant" aria-current={pathname.startsWith('/assistant') ? 'page' : undefined}
                className="flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-primary">
                <Icon name="inbox" className="size-[1.125rem]" />{t('assistant')}
              </Link>
            </li>
            <li>
              <Link href="/notifications" aria-current={pathname.startsWith('/notifications') ? 'page' : undefined} aria-label={count ? t('notificationsCount', { count }) : t('notifications')} title={t('notifications')}
                className="relative grid size-9 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-foreground aria-[current=page]:text-primary">
                <Icon name="bell" className="size-[1.125rem]" />
                {count && <span className="num absolute -end-0.5 -top-0.5 min-w-4 rounded-[3px] bg-brand-gold px-1 text-center text-[0.625rem] font-bold text-forest">{count}</span>}
              </Link>
            </li>
            <li>
              <Link href="/settings" aria-current={pathname.startsWith('/settings') ? 'page' : undefined} aria-label={t('settings')} title={t('settings')}
                className="grid size-9 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-foreground aria-[current=page]:text-primary">
                <Icon name="settings" className="size-[1.125rem]" />
              </Link>
            </li>
          </ul>
        </div>
      </nav>

      <nav id="candidate-tabbar" aria-label={t('label')} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {ITEMS.filter(([href]) => TABS.includes(href)).map(([href, key, icon]) => {
            const current = isCurrent(href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={clsx('relative flex h-[4.25rem] flex-col items-center justify-center gap-1 text-[0.6875rem] leading-tight transition-colors', current ? 'font-semibold text-foreground' : 'text-muted')}
                >
                  {current && <motion.span layoutId="candidate-tab" aria-hidden className="absolute inset-x-5 top-0 h-0.5 bg-gold" transition={{ duration: 0.35, ease: EASE }} />}
                  <Icon name={icon} className={clsx('size-[1.375rem]', current && 'text-primary')} />
                  <span className="max-w-full truncate px-1">{t(key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
