import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider, useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Header, Providers } from '@/components/chrome';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { signOut } from '@/lib/auth-actions';
import { CandidateNav } from '@/components/candidate-nav';
import { api } from '@/lib/api';
import { getSession } from '@/lib/session';
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

function DemoBanner() {
  const t = useTranslations();
  return <p className="bg-surface-2 px-4 py-1.5 text-center text-xs font-medium">{t('demoBanner')}</p>;
}

function Footer() {
  const t = useTranslations();
  const links = [
    ['/opportunities', 'opportunities'],
    ['/employers', 'employers'],
    ['/how-it-works', 'how'],
    ['/for-candidates', 'candidates'],
    ['/for-organizations', 'organizations'],
    ['/about', 'about'],
    ['/faq', 'faq'],
    ['/register', 'getStarted'],
  ] as const;
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-sm sm:px-6">
        <p className="text-muted">{t('brand.full')} · {t('footer.status')}</p>
        <nav aria-label={t('footer.explore')} className="flex flex-wrap gap-x-4 gap-y-1">
          {links.map(([href, key]) => (
            <Link key={href} href={href} className="text-muted hover:text-foreground">
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
  const isCandidate = Boolean(session) && session?.accountType !== 'organization';
  const unread = isCandidate ? await api<{ unread: number }>('/me/notifications/unread-count').then((r) => r.unread, () => 0) : 0;
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
            <Header signedIn={Boolean(session)} candidate={isCandidate} signOut={signOut} />
            <DemoBanner />
            {isCandidate && <CandidateNav unread={unread} />}
            <main id="main" className="flex-1">{children}</main>
            <Footer />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
