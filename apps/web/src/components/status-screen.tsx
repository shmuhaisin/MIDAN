import clsx from 'clsx';
import { Humaidan } from './brand';
import { Icon } from './icons';

/**
 * A whole-page moment with one message and one way forward: email sent, address confirmed, page not found, something
 * went wrong. Humaidan stands beside it on his own, with a soft shadow at his feet: no box or frame around him. A small
 * mark before the title says whether it's good news, a problem, or simply information.
 */
export function StatusScreen({ code, title, body, note, tone = 'neutral', children }: {
  code?: string;
  title: string;
  body: React.ReactNode;
  note?: string;
  tone?: 'neutral' | 'success' | 'problem';
  children?: React.ReactNode;
}) {
  return (
    <section className="container-page py-12 lg:py-20">
      <div className="mx-auto grid w-full max-w-4xl items-center gap-8 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-16">
        <div className="order-2 md:order-1">
          {code && <p className="num font-display text-5xl font-bold text-gold-text">{code}</p>}
          <p className={clsx('inline-flex size-9 items-center justify-center rounded-full', tone === 'problem' ? 'bg-error-surface text-error' : tone === 'success' ? 'bg-success-surface text-success' : 'bg-accent text-accent-foreground')} aria-hidden>
            <Icon name={tone === 'problem' ? 'alert' : tone === 'success' ? 'check' : 'mail'} className="size-4" />
          </p>
          <h1 className="display-lg mt-4 text-balance">{title}</h1>
          <div className="mt-3 max-w-xl text-lg leading-relaxed text-muted">{body}</div>
          {note && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">{note}</p>}
          {children && <div className="mt-8 max-w-xl space-y-4">{children}</div>}
        </div>
        <div aria-hidden className="relative order-1 mx-auto w-32 md:order-2 md:w-full">
          <Humaidan sizes="(min-width: 768px) 208px, 128px" idle />
          <span className="absolute inset-x-[18%] -bottom-1 h-3 rounded-[50%] bg-foreground/10 blur-[6px]" />
        </div>
      </div>
    </section>
  );
}
