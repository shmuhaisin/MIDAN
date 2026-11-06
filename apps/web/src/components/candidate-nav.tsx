'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

const ITEMS = [['/dashboard', 'dashboard'], ['/opportunities', 'jobs'], ['/development', 'development'], ['/notifications', 'notifications'], ['/profile', 'profile'], ['/settings', 'settings']] as const;
const OWNS = { '/dashboard': ['/dashboard', '/applications', '/interviews', '/reports'], '/opportunities': ['/opportunities', '/employers'] } as Record<string, string[]>;

/** The signed-in candidate's navigation, once per page. Screens that need full attention go without it. */
export function CandidateNav({ unread = 0 }: { unread?: number }) {
  const t = useTranslations('candidateNav');
  const pathname = usePathname();
  if (pathname.startsWith('/experience') || pathname.startsWith('/onboarding') || pathname.startsWith('/organization') || pathname.startsWith('/admin')) return null;
  const isCurrent = (href: string) => (OWNS[href] ?? [href]).some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <nav aria-label={t('label')} className="border-b border-border">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {ITEMS.map(([href, key]) => (
          <li key={key} className="shrink-0">
            <Link
              href={href} aria-current={isCurrent(href) ? 'page' : undefined}
              className={clsx('inline-block border-b-2 px-3 py-2.5 text-sm transition-colors hover:text-foreground', isCurrent(href) ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted')}
            >
              {t(key)}
              {key === 'notifications' && unread > 0 && <span className="ms-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">{unread}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
