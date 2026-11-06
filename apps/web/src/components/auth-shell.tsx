import { useTranslations } from 'next-intl';
import { Humaidan, TriangleField } from './brand';

export type Audience = 'candidate' | 'organization';

/** Candidates are welcomed by Original Humaidan. Employers get a formal panel, with no mascot. */
export function AuthShell({ audience, title, lead, children }: { audience: Audience; title: string; lead: string; children: React.ReactNode }) {
  const t = useTranslations('auth');
  return (
    <section className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_20rem] lg:items-center lg:py-12">
      <div className="mx-auto w-full max-w-md">
        <h1 className="page-title">{title}</h1>
        <p className="mt-1.5 mb-6 text-muted">{lead}</p>
        {children}
      </div>
      {audience === 'candidate' ? (
        <div className="relative mx-auto w-full max-w-[9rem] sm:max-w-[16rem]">
          <div className="najdi-arch relative aspect-[5/6] overflow-hidden bg-deep text-mint/15"><TriangleField /></div>
          <div className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"><Humaidan sizes="(min-width: 1024px) 280px, 170px" priority idle /></div>
        </div>
      ) : (
        <aside className="on-deep relative hidden overflow-hidden rounded-lg bg-deep p-6 text-deep-foreground lg:block">
          <span className="text-mint/10"><TriangleField /></span>
          <ul className="relative space-y-6">
            {(t.raw('orgPoints') as string[]).map((point) => (
              <li key={point} className="border-s-2 border-gold ps-3 font-medium leading-snug">{point}</li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}
