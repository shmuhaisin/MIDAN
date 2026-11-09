'use client';

import clsx from 'clsx';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { Arrow, Logo } from './brand';
import { Icon } from './icons';

const NAV = [
  ['/opportunities', 'opportunities'],
  ['/how-it-works', 'how'],
  ['/for-candidates', 'candidates'],
  ['/for-organizations', 'organizations'],
  ['/about', 'about'],
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;

/** nonce: this request's Content-Security-Policy nonce, which the theme script needs to run. */
export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
      // The theme script only needs to run from the server's HTML. React 19 reports an error if
      // an executable script is rendered again on the client, which layout refreshes do.
      scriptProps={{ type: typeof window === 'undefined' ? 'text/javascript' : 'application/json' }}
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeProvider>
  );
}

const subscribeNoop = () => () => {};

export function ThemeSwitch({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const options = [
    ['light', 'M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6 15 15M5 15l1.4-1.4M13.6 6.4 15 5M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    ['dark', 'M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5z'],
    ['system', 'M3 5h14v8H3zM7 16.5h6M10 13v3.5'],
  ] as const;
  return (
    <div role="radiogroup" aria-label={t('label')} className={clsx('flex rounded-[var(--radius-control)] border border-border p-0.5', className)}>
      {options.map(([value, d]) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(value)}
            title={t(value)}
            onClick={() => setTheme(value)}
            className={clsx(
              'relative grid size-8 place-items-center rounded-[calc(var(--radius-control)-2px)] transition-colors',
              active ? 'text-[var(--button-foreground)]' : 'text-muted hover:text-foreground',
            )}
          >
            {active && (
              <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-[calc(var(--radius-control)-2px)] bg-[var(--button)]" transition={{ duration: 0.25, ease: EASE }} />
            )}
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="relative size-4">
              <path d={d} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

export function LocaleSwitch({ className }: { className?: string }) {
  const t = useTranslations('locale');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      lang={locale === 'ar' ? 'en' : 'ar'}
      aria-label={t('label')}
      disabled={pending}
      onClick={() =>
        start(() => router.replace(`${pathname}${window.location.search}`, { locale: locale === 'ar' ? 'en' : 'ar' }))
      }
      className={clsx('btn btn-ghost btn-sm gap-1.5 px-2.5', className)}
    >
      <Icon name="globe" className="size-4 text-muted" />
      {t('switch')}
    </button>
  );
}

/** The official logo beside the name, set as one lockup. */
export function Brand({ className, onDeep = false }: { className?: string; onDeep?: boolean }) {
  const t = useTranslations('brand');
  return (
    <Link href="/" aria-label="الميدان — MIDAN" className={clsx('group flex shrink-0 items-center gap-3', className)}>
      <Logo decorative priority className="h-11 transition-transform duration-500 group-hover:scale-[1.04] sm:h-12" sizes="96px" />
      <span aria-hidden className={clsx('h-7 w-px', onDeep ? 'bg-mint/30' : 'bg-gold/70')} />
      <span className="font-display text-xl leading-none font-bold">{t('name')}</span>
    </Link>
  );
}

export function Header({ signedIn, candidate, signOut }: { signedIn: boolean; candidate: boolean; signOut: () => Promise<void> }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  // Candidates have their own navigation under the header.
  const items = candidate ? [] : signedIn ? NAV.filter(([href]) => href === '/opportunities') : NAV;
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={clsx(
        'sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300',
        scrolled || open ? 'border-border bg-background/90 backdrop-blur-md' : 'border-transparent bg-background',
      )}
    >
      <a href="#main" className="skip-link">{t('nav.skip')}</a>
      <div className="container-page flex h-[4.5rem] items-center gap-8">
        <Brand />
        <nav aria-label={t('nav.primary')} className="hidden flex-1 items-center gap-1 lg:flex">
          {items.map(([href, key]) => {
            const current = isCurrent(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={clsx(
                  'group relative px-3 py-2 text-[0.9375rem] transition-colors',
                  current ? 'font-semibold text-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {t(`nav.${key}`)}
                {current ? (
                  <motion.span layoutId="nav-current" aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 bg-gold" transition={{ duration: 0.35, ease: EASE }} />
                ) : (
                  <span aria-hidden className="absolute inset-x-3 -bottom-px h-px origin-left scale-x-0 bg-foreground/40 transition-transform duration-300 group-hover:scale-x-100 rtl:origin-right" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <div className="hidden items-center gap-1.5 md:flex">
            <LocaleSwitch />
            <ThemeSwitch />
          </div>
          {signedIn ? (
            <>
              {!candidate && (
                <Link href="/dashboard" className="btn btn-primary btn-sm hidden lg:inline-flex">
                  {t('nav.dashboard')}
                </Link>
              )}
              <form action={signOut} className="hidden lg:block">
                <button type="submit" className="btn btn-ghost btn-sm text-muted">
                  <Icon name="logout" className="size-4" />
                  {t('nav.signOut')}
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm hidden lg:inline-flex">
                {t('nav.login')}
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm hidden lg:inline-flex">
                {t('nav.getStarted')}
                <Arrow />
              </Link>
            </>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? t('nav.closeMenu') : t('nav.menu')}
            onClick={() => setOpen((v) => !v)}
            className="grid size-11 place-items-center rounded-[var(--radius-control)] border border-border transition-colors hover:bg-surface-2 lg:hidden"
          >
            <Icon name={open ? 'close' : 'menu'} />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-nav"
            aria-label={t('nav.primary')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-0 top-[4.5rem] bottom-0 z-40 flex flex-col overflow-y-auto border-t border-border bg-background lg:hidden"
          >
            <ol className="container-page flex-1 py-6">
              {items.map(([href, key], i) => (
                <motion.li
                  key={href}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.04 * i, ease: EASE }}
                  className="border-b border-border"
                >
                  <Link
                    href={href}
                    aria-current={isCurrent(href) ? 'page' : undefined}
                    className="flex items-baseline gap-4 py-4 font-display text-2xl font-bold aria-[current=page]:text-primary"
                  >
                    <span aria-hidden className="num w-7 text-sm font-semibold text-gold-text">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1">{t(`nav.${key}`)}</span>
                    <Arrow className="size-5 self-center text-muted" />
                  </Link>
                </motion.li>
              ))}
              {candidate && ([['/assessments', 'assessments', 'file'], ['/notifications', 'notifications', 'bell'], ['/interviews', 'interviews', 'calendar'], ['/assistant', 'assistant', 'inbox'], ['/settings', 'settings', 'settings']] as const).map(([href, key, icon]) => (
                <li key={href} className="border-b border-border">
                  <Link href={href} aria-current={isCurrent(href) ? 'page' : undefined} className="flex items-center gap-4 py-4 text-lg font-semibold aria-[current=page]:text-primary">
                    <Icon name={icon} className="text-muted" />
                    {t(`candidateNav.${key}`)}
                  </Link>
                </li>
              ))}
            </ol>
            <div className="container-page space-y-3 border-t border-border bg-surface py-5">
              {signedIn ? (
                <>
                  {!candidate && <Link href="/dashboard" className="btn btn-primary btn-lg btn-block">{t('nav.dashboard')}</Link>}
                  <form action={signOut}>
                    <button type="submit" className="btn btn-secondary btn-block">
                      <Icon name="logout" className="size-4" />
                      {t('nav.signOut')}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/register" className="btn btn-primary btn-lg btn-block">{t('nav.getStarted')}<Arrow /></Link>
                  <Link href="/login" className="btn btn-secondary btn-block">{t('nav.login')}</Link>
                </>
              )}
              <div className="flex items-center justify-between pt-2">
                <ThemeSwitch />
                <LocaleSwitch />
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
