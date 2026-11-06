import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

const ITEMS = [['/dashboard', 'dashboard'], ['/opportunities', 'jobs'], ['/development', 'development'], ['/notifications', 'notifications'], ['/profile', 'profile'], ['/settings', 'settings']] as const;

export function CandidateNav({ current, unread = 0 }: { current: (typeof ITEMS)[number][1]; unread?: number }) {
  const t = useTranslations('candidateNav');
  return (
    <nav aria-label={t('label')} className="border-b border-border">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {ITEMS.map(([href, key]) => (
          <li key={key} className="shrink-0">
            <Link
              href={href} aria-current={current === key ? 'page' : undefined}
              className={clsx('inline-block border-b-2 px-3 py-3 text-sm transition-colors hover:text-foreground', current === key ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted')}
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
