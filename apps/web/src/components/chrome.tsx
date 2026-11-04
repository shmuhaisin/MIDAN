'use client';

import clsx from 'clsx';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { Arrow, Mark } from './brand';

const NAV = [
  ['/opportunities', 'opportunities'],
  ['/how-it-works', 'how'],
  ['/for-candidates', 'candidates'],
  ['/for-organizations', 'organizations'],
  ['/faq', 'faq'],
] as const;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeProvider>
  );
}

const subscribeNoop = () => () => {};

function ThemeSwitch() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const options = [
    ['light', 'M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6 15 15M5 15l1.4-1.4M13.6 6.4 15 5M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    ['dark', 'M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5z'],
    ['system', 'M3 5h14v8H3zM7 16.5h6M10 13v3.5'],
  ] as const;
  return (
    <div role="radiogroup" aria-label={t('label')} className="flex rounded-full border border-border p-0.5">
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
              'relative grid size-8 place-items-center rounded-full transition-colors',
              active ? 'text-primary-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {active && (
              <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ duration: 0.2 }} />
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

function LocaleSwitch() {
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
      className="h-9 rounded-full border border-border px-3.5 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {t('switch')}
    </button>
  );
}

export function Header({ signedIn, signOut }: { signedIn: boolean; signOut: () => Promise<void> }) {
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
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header
      className={clsx(
        'sticky top-0 z-40 border-b transition-colors',
        scrolled || open ? 'border-border bg-background/95 backdrop-blur' : 'border-transparent bg-background',
      )}
    >
      <a href="#main" className="skip-link">{t('nav.skip')}</a>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <Mark />
          {t('brand.name')}
        </Link>
        <nav aria-label={t('nav.primary')} className="hidden flex-1 items-center gap-1 lg:flex">
          {NAV.map(([href, key]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className={clsx(
                'rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-surface-2',
                pathname === href ? 'font-semibold text-primary' : 'text-muted hover:text-foreground',
              )}
            >
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">
            <ThemeSwitch />
            <LocaleSwitch />
          </div>
          {signedIn ? (
            <>
              <Link href="/dashboard" className="hidden h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-px active:translate-y-0 lg:inline-flex">
                {t('nav.dashboard')}
              </Link>
              <form action={signOut} className="hidden lg:block">
                <button type="submit" className="h-9 rounded-full px-3 text-sm text-muted transition-colors hover:text-foreground">{t('nav.signOut')}</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden h-9 items-center rounded-full px-3 text-sm font-medium transition-colors hover:bg-surface-2 lg:inline-flex">
                {t('nav.login')}
              </Link>
              <Link href="/register" className="hidden h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-px active:translate-y-0 lg:inline-flex">
                {t('nav.getStarted')}
              </Link>
            </>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? t('nav.closeMenu') : t('nav.menu')}
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full border border-border lg:hidden"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5">
              <path d={open ? 'M5 5l10 10M15 5L5 15' : 'M3 6h14M3 10h14M3 14h14'} />
            </svg>
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.nav
            id="mobile-nav"
            aria-label={t('nav.primary')}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-t border-border lg:hidden"
          >
            <div className="flex flex-col gap-1 px-4 py-4">
              {NAV.map(([href, key]) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? 'page' : undefined}
                  className="flex items-center justify-between rounded-lg px-3 py-3 font-medium hover:bg-surface-2"
                >
                  {t(`nav.${key}`)}
                  <Arrow className="text-muted" />
                </Link>
              ))}
              {signedIn ? (
                <>
                  <Link href="/dashboard" className="mt-2 rounded-full bg-primary px-4 py-3 text-center font-semibold text-primary-foreground">{t('nav.dashboard')}</Link>
                  <form action={signOut}>
                    <button type="submit" className="w-full rounded-full px-4 py-3 font-medium text-muted">{t('nav.signOut')}</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/register" className="mt-2 rounded-full bg-primary px-4 py-3 text-center font-semibold text-primary-foreground">{t('nav.getStarted')}</Link>
                  <Link href="/login" className="rounded-full px-4 py-3 text-center font-medium">{t('nav.login')}</Link>
                </>
              )}
              <div className="mt-3 flex items-center justify-between sm:hidden">
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
