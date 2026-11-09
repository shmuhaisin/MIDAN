import clsx from 'clsx';
import { Humaidan } from './brand';

/**
 * A whole-page moment with one message and one way forward: email sent, address confirmed, page not found, something
 * went wrong. Humaidan stands in a small Najdi arch; the tone strip says whether it's good news or a problem.
 */
export function StatusScreen({ code, title, body, note, tone = 'neutral', children }: {
  code?: string;
  title: string;
  body: string;
  note?: string;
  tone?: 'neutral' | 'success' | 'problem';
  children?: React.ReactNode;
}) {
  return (
    <section className="container-page flex min-h-[calc(100svh-12rem)] items-center py-14">
      <div className="mx-auto grid w-full max-w-4xl items-center gap-10 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-14">
        <div aria-hidden className="relative mx-auto w-40 md:w-full">
          <div className="najdi-arch relative aspect-[5/6] overflow-hidden bg-deep">
            <span className={clsx('absolute inset-x-[8%] bottom-0 h-1', tone === 'problem' ? 'bg-error' : tone === 'success' ? 'bg-mint' : 'bg-brand-gold')} />
          </div>
          <div className="absolute inset-x-0 bottom-0 mx-auto w-[74%]"><Humaidan sizes="220px" idle /></div>
        </div>
        <div className="text-center md:text-start">
          {code && <p className="num font-display text-6xl font-bold text-gold">{code}</p>}
          <h1 className="display-lg mt-2 text-balance">{title}</h1>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-muted md:max-w-none">{body}</p>
          {note && <p className="mt-2 text-sm text-muted">{note}</p>}
          {children && <div className="mt-8 flex flex-wrap justify-center gap-3 md:justify-start">{children}</div>}
        </div>
      </div>
    </section>
  );
}
