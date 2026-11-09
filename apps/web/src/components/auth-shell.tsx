import { useTranslations } from 'next-intl';
import { Humaidan, Logo, Parapet } from './brand';

export type Audience = 'candidate' | 'organization';

/**
 * Sign-in, sign-up and recovery. The form stands alone on the start side; the end side is MIDAN's world: Humaidan in a
 * Najdi arch for candidates, a formal panel with the logo for organizations (no mascot).
 */
export function AuthShell({ audience, title, lead, children }: { audience: Audience; title: string; lead: string; children: React.ReactNode }) {
  const t = useTranslations();
  const org = audience === 'organization';
  return (
    <section className="grid min-h-[calc(100svh-4.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex items-center justify-center px-4 py-12 sm:px-6 lg:py-16">
        <div className="w-full max-w-md">
          <p className="flex items-center gap-3 text-sm font-semibold text-gold-text">
            <span aria-hidden className="h-px w-8 bg-gold" />
            {t(org ? 'nav.organizations' : 'nav.candidates')}
          </p>
          <h1 className="display-lg mt-4 text-balance">{title}</h1>
          <p className="mt-3 mb-8 leading-relaxed text-muted">{lead}</p>
          {children}
        </div>
      </div>

      <aside aria-hidden className="on-deep deep-grain relative order-first overflow-hidden bg-deep text-deep-foreground lg:order-none">
        {org ? (
          <div className="relative flex h-full flex-col justify-center gap-8 px-6 py-8 lg:px-14 lg:py-16">
            <span className="max-w-[10rem] rounded-[var(--radius-panel)] bg-ivory p-2 lg:max-w-sm lg:p-4"><Logo decorative className="h-auto w-full" sizes="(min-width: 1024px) 380px, 160px" /></span>
            <ul className="hidden space-y-6 lg:block">
              {(t.raw('auth.orgPoints') as string[]).map((point, i) => (
                <li key={point} className="flex items-baseline gap-4">
                  <span className="num text-sm font-semibold text-brand-gold">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-display text-base leading-snug font-semibold lg:text-xl">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="relative flex h-full items-end justify-center px-6 pt-6 lg:px-14 lg:pt-16">
            <div className="relative w-full max-w-[9rem] lg:max-w-sm">
              <div className="najdi-arch relative aspect-[5/6] overflow-hidden bg-brand-green/30">
                <span className="absolute inset-x-[8%] bottom-0 h-1 bg-brand-gold" />
              </div>
              <div className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"><Humaidan sizes="(min-width: 1024px) 320px, 110px" priority idle /></div>
            </div>
          </div>
        )}
        <Parapet className="absolute inset-x-0 bottom-0 hidden h-5 text-background lg:block" />
      </aside>
    </section>
  );
}
