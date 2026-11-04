import { useTranslations } from 'next-intl';
import { Eyebrow, Humaidan, TriangleField } from './brand';

export type Audience = 'candidate' | 'organization';

/** Candidates are welcomed by Original Humaidan. Employers get a formal panel, with no mascot. */
export function AuthShell({ audience, title, lead, children }: { audience: Audience; title: string; lead: string; children: React.ReactNode }) {
  const t = useTranslations('auth');
  const tb = useTranslations('home');
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-14">
      <div className="mx-auto w-full max-w-md">
        <Eyebrow className="text-muted">{tb('eyebrow')}</Eyebrow>
        <h1 className="mt-3 font-display text-4xl leading-tight font-bold">{title}</h1>
        <p className="mt-2 mb-8 text-lg text-muted">{lead}</p>
        {children}
      </div>
      {audience === 'candidate' ? (
        <div className="relative mx-auto w-full max-w-[14rem] lg:max-w-sm lg:-order-none">
          <div className="najdi-arch relative aspect-[5/6] overflow-hidden bg-deep text-mint/15"><TriangleField /></div>
          <div className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"><Humaidan sizes="(min-width: 1024px) 280px, 170px" priority idle /></div>
        </div>
      ) : (
        <aside className="on-deep relative hidden overflow-hidden rounded-lg bg-deep p-10 text-deep-foreground lg:block">
          <span className="text-mint/10"><TriangleField /></span>
          <ul className="relative space-y-6">
            {(t.raw('orgPoints') as string[]).map((point) => (
              <li key={point} className="border-s-2 border-gold ps-4 font-display text-xl leading-snug font-semibold">{point}</li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}
