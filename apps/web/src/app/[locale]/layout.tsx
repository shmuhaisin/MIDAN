import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider, useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Parapet } from '@/components/brand';
import { Header, Providers } from '@/components/chrome';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { signOut } from '@/lib/auth-actions';
import { getSession } from '@/lib/session';
import '../globals.css';

// Same approved families, weights and CSS variables; build without Google network access.
// Sources, licenses and pinned upstream checksums are in src/fonts/manifest.json.
const plexArabic = localFont({
  src: [
    { path: '../../fonts/IBMPlexSansArabic-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../../fonts/IBMPlexSansArabic-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../../fonts/IBMPlexSansArabic-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../../fonts/IBMPlexSansArabic-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-arabic', display: 'swap',
});
const plex = localFont({ src: '../../fonts/IBMPlexSans.ttf', weight: '400 700', style: 'normal', variable: '--font-plex', display: 'swap' });
const kufi = localFont({ src: '../../fonts/NotoKufiArabic.woff2', weight: '100 900', style: 'normal', variable: '--font-kufi', display: 'swap' });
const bricolage = localFont({ src: '../../fonts/BricolageGrotesque.woff2', weight: '200 800', style: 'normal', variable: '--font-bricolage', display: 'swap' });

type Params = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return { title: t('title'), description: t('description') };
}

function DemoBanner() {
  const t = useTranslations();
  return <p className="bg-surface-2 px-4 py-1.5 text-center text-xs font-medium">{t('demoBanner')}</p>;
}

function Footer() {
  const t = useTranslations();
  const links = [
    ['/opportunities', 'opportunities'],
    ['/how-it-works', 'how'],
    ['/for-candidates', 'candidates'],
    ['/for-organizations', 'organizations'],
    ['/about', 'about'],
    ['/faq', 'faq'],
    ['/register', 'getStarted'],
  ] as const;
  return (
    <footer className="on-deep bg-deep text-deep-foreground">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2">
        <div>
          <p className="font-display text-2xl font-bold">{t('brand.full')}</p>
          <p className="mt-3 max-w-sm text-deep-muted">{t('footer.tagline')}</p>
          <p className="mt-6 text-sm text-deep-muted">{t('footer.status')}</p>
        </div>
        <nav aria-label={t('footer.explore')} className="grid grid-cols-2 gap-x-6 gap-y-2 md:justify-self-end">
          {links.map(([href, key]) => (
            <Link key={href} href={href} className="py-1 hover:text-mint">
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export default async function LocaleLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await getSession();
  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${plexArabic.variable} ${plex.variable} ${kufi.variable} ${bricolage.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>
          <Providers>
            <Header signedIn={Boolean(session)} signOut={signOut} />
            <DemoBanner />
            <main id="main" className="flex-1">{children}</main>
            <Parapet className="text-deep" />
            <Footer />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
