import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Parapet } from './brand';

const COLUMNS = [
  ['platform', [['/opportunities', 'opportunities'], ['/employers', 'employers'], ['/how-it-works', 'how']]],
  ['audiences', [['/for-candidates', 'candidates'], ['/for-organizations', 'organizations'], ['/register', 'getStarted']]],
  ['company', [['/about', 'about'], ['/faq', 'faq'], ['/login', 'login']]],
] as const;

export function SiteFooter() {
  const t = useTranslations();
  return (
    <footer className="on-deep relative mt-auto text-deep-foreground">
      <Parapet className="text-deep" />
      <div className="deep-grain bg-deep">
        <div className="container-page grid gap-12 py-14 lg:grid-cols-12 lg:py-16">
          <div className="lg:col-span-5">
            {/* One logo per page (owner decision, 2026-11-06): the header carries it, so the footer names the brand in type. */}
            <Link href="/" className="inline-block font-display text-2xl leading-snug font-bold hover:text-brand-gold">{t('brand.full')}</Link>
            <p className="mt-3 max-w-sm leading-relaxed text-deep-muted">{t('footer.tagline')}</p>
          </div>
          <nav aria-label={t('footer.explore')} className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            {COLUMNS.map(([title, links]) => (
              <div key={title}>
                <p className="flex items-center gap-2 text-sm font-semibold text-brand-gold">
                  <span aria-hidden className="size-1.5 rotate-45 bg-brand-gold" />
                  {t(`footer.columns.${title}`)}
                </p>
                <ul className="mt-4 space-y-3">
                  {links.map(([href, key]) => (
                    <li key={href}>
                      <Link href={href} className="text-deep-muted transition-colors hover:text-ivory">
                        {t(`nav.${key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="border-t border-mint/15">
          <p className="container-page py-5 text-sm text-deep-muted">{t('footer.status')}</p>
        </div>
      </div>
    </footer>
  );
}

/** The development notice: visible on every page, never alarming. */
export function DemoBanner() {
  const t = useTranslations();
  return (
    <p className="flex items-center justify-center gap-2 border-b border-border bg-surface-2 px-4 py-1.5 text-center text-xs font-medium text-muted">
      <span aria-hidden className="size-1.5 shrink-0 rotate-45 bg-gold" />
      {t('demoBanner')}
    </p>
  );
}
