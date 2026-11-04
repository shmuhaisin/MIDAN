import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider, useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Parapet } from '@/components/brand';
import { Header, Providers } from '@/components/chrome';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import '../globals.css';

const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '500', '600', '700'], variable: '--font-plex-arabic', display: 'swap' });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex', display: 'swap' });
const kufi = Noto_Kufi_Arabic({ subsets: ['arabic'], variable: '--font-kufi', display: 'swap' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });

type Params = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return { title: t('title'), description: t('description') };
}

function Footer() {
  const t = useTranslations();
  const links = [
    ['/how-it-works', 'how'],
    ['/for-candidates', 'candidates'],
    ['/for-organizations', 'organizations'],
    ['/about', 'about'],
    ['/faq', 'faq'],
    ['/get-started', 'getStarted'],
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
  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      suppressHydrationWarning
      className={`${plexArabic.variable} ${plex.variable} ${kufi.variable} ${bricolage.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>
          <Providers>
            <Header />
            <main id="main" className="flex-1">{children}</main>
            <Parapet className="text-deep" />
            <Footer />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
