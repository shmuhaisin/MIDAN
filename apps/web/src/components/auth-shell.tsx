import { Humaidan, TriangleField } from './brand';

/** Sign-in and sign-up: the form beside the same arch as the home page. */
export function AuthShell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="font-display text-4xl font-bold">{title}</h1>
        <p className="mt-2 mb-8 text-lg text-muted">{lead}</p>
        {children}
      </div>
      <div aria-hidden className="relative mx-auto hidden w-full max-w-sm lg:block">
        <div className="najdi-arch relative aspect-[5/6] overflow-hidden bg-deep text-mint/15"><TriangleField /></div>
        <div className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"><Humaidan sizes="280px" /></div>
      </div>
    </section>
  );
}
