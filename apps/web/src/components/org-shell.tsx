'use client';

import clsx from 'clsx';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Icon, type IconName } from './icons';

const EASE = [0.22, 1, 0.36, 1] as const;

const ITEMS: { key: string; path: string; icon: IconName; also?: string[] }[] = [
  { key: 'overview', path: '', icon: 'layers' },
  { key: 'jobs', path: '/jobs', icon: 'briefcase' },
  { key: 'candidates', path: '/candidates', icon: 'users', also: ['/applicants'] },
  { key: 'assessments', path: '/assessments', icon: 'file', also: ['/review'] },
  { key: 'interviews', path: '/interviews', icon: 'calendar' },
  { key: 'hiring', path: '/hiring', icon: 'check' },
  { key: 'reports', path: '/reports', icon: 'growth' },
  { key: 'assistant', path: '/assistant', icon: 'inbox' },
  { key: 'settings', path: '/settings', icon: 'settings' },
];

/** The employer workspace's nine places. A job's, applicant's or review's own page marks its place as current. */
export function OrgNav({ orgId }: { orgId: string }) {
  const t = useTranslations('orgShell');
  const pathname = usePathname();
  const base = `/organization/${orgId}`;
  return (
    <nav aria-label={t('nav')}>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
        {ITEMS.map((item) => {
          const current = item.path === ''
            ? pathname === base
            : [item.path, ...(item.also ?? [])].some((p) => pathname === base + p || pathname.startsWith(`${base}${p}/`));
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={`${base}${item.path}`}
                aria-current={current ? 'page' : undefined}
                className={clsx(
                  'relative flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm transition-colors',
                  current ? 'bg-surface font-semibold text-foreground lg:shadow-[inset_0_0_0_1px_var(--border)]' : 'text-muted hover:bg-surface/70 hover:text-foreground',
                )}
              >
                {current && <motion.span layoutId="org-current" aria-hidden className="absolute inset-y-2 start-0 hidden w-0.5 bg-[var(--org-primary,var(--gold))] lg:block" transition={{ duration: 0.35, ease: EASE }} />}
                <Icon name={item.icon} className={clsx('size-[1.125rem]', current && 'text-primary')} />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
