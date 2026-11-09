import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from 'next/font/google';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Header, Providers } from '@/components/chrome';
import { routing } from '@/i18n/routing';
import { signOut } from '@/lib/auth-actions';
import { CandidateNav } from '@/components/candidate-nav';
import { DemoBanner, SiteFooter } from '@/components/site-footer';
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

export default async function LocaleLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await getSession();
  const isCandidate = Boolean(session) && session?.accountType !== 'organization';
  const unread = isCandidate ? await api<{ unread: number }>('/me/notifications/unread-count').then((r) => r.unread, () => 0) : 0;
  // Set by src/proxy.ts with the page's Content-Security-Policy.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${plexArabic.variable} ${plex.variable} ${kufi.variable} ${bricolage.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        {/* Without JavaScript, content that would rise into view simply shows. */}
        <noscript><style>{'[data-reveal]{opacity:1!important;transform:none!important}'}</style></noscript>
        <NextIntlClientProvider>
          <Providers nonce={nonce}>
            <Header signedIn={Boolean(session)} candidate={isCandidate} signOut={signOut} />
            <DemoBanner />
            {isCandidate && <CandidateNav unread={unread} />}
            <main id="main" className="flex-1">{children}</main>
            <SiteFooter />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
