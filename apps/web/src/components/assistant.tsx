'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { askAssistant, type AssistantReply } from '@/lib/assistant-actions';
import { Arrow } from './brand';

type Message = { role: 'user'; text: string } | { role: 'assistant'; reply: AssistantReply } | { role: 'error'; text: string };

/**
 * A conversation with MIDAN's assistant. It answers from what the asker may already see, shows the facts each answer
 * used, and links to the page where anything is done: it never acts. The conversation lives in this page only.
 */
export function AssistantChat({ scope, orgId, suggestions }: { scope: 'candidate' | 'organization'; orgId?: string; suggestions: string[] }) {
  const t = useTranslations('assistant');
  const locale = useLocale() as 'ar' | 'en';
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, pending]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    type Turn = { role: 'user' | 'assistant'; text: string };
    const history = messages.flatMap((m): Turn[] => m.role === 'user' ? [{ role: 'user', text: m.text }] : m.role === 'assistant' ? [{ role: 'assistant', text: m.reply.answer }] : []).slice(-6);
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setDraft('');
    start(async () => {
      const result = await askAssistant({ scope, orgId, question: q, locale, history });
      setMessages((m) => [...m, result.reply ? { role: 'assistant', reply: result.reply } : { role: 'error', text: t(`errors.${result.error ?? 'unavailable'}`) }]);
    });
  };

  return (
    <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface">
      <div role="log" aria-live="polite" aria-label={t('log')} className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
        {messages.length === 0 && (
          <div>
            <p className="font-display text-xl font-bold">{t('emptyTitle')}</p>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t(scope === 'candidate' ? 'emptyCandidate' : 'emptyOrganization')}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => <li key={s}><button type="button" onClick={() => ask(s)} className="chip hover:border-foreground">{s}</button></li>)}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="flex justify-end"><p dir="auto" className="max-w-[85%] rounded-[var(--radius-panel)] bg-deep px-4 py-3 text-deep-foreground">{m.text}</p></div>
          ) : m.role === 'error' ? (
            <p key={i} role="alert" className="callout text-sm">{m.text}</p>
          ) : (
            <div key={i} className="max-w-[92%]">
              <div className={clsx('rounded-[var(--radius-panel)] border px-4 py-3', m.reply.mode === 'live' ? 'border-border bg-surface-2/40' : 'border-dashed border-border-strong')}>
                {m.reply.mode !== 'live' && <p className="mb-2 text-xs font-semibold text-gold-text">{t('retrievalOnly')}</p>}
                <p dir="auto" className="whitespace-pre-line leading-relaxed">{m.reply.answer}</p>
                {m.reply.links.length > 0 && (
                  <p className="mt-3 flex flex-wrap gap-2">
                    {m.reply.links.map((l) => <Link key={l.key} href={l.href} className="btn btn-secondary btn-sm">{l.label}<Arrow /></Link>)}
                  </p>
                )}
              </div>
              {m.reply.facts.length > 0 && (
                <details className="mt-2 text-sm text-muted">
                  <summary className="cursor-pointer">{t('basedOn', { count: m.reply.facts.length })}</summary>
                  <ul className="mt-2 space-y-1 border-s-2 border-gold ps-3">{m.reply.facts.map((f) => <li key={f.id} dir="auto">{f.text}</li>)}</ul>
                </details>
              )}
              {m.reply.mode === 'live' && !m.reply.grounded && <p className="mt-2 text-xs text-warning">{t('ungrounded')}</p>}
            </div>
          )
        ))}
        {pending && <p role="status" className="text-sm text-muted">{t('thinking')}</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-border p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('ask')}</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} dir="auto" placeholder={t('placeholder')} className="input mt-0 w-full" />
        </label>
        <button type="submit" disabled={pending || !draft.trim()} aria-busy={pending} className="btn btn-primary">{t('send')}</button>
      </form>
      <p className="border-t border-border bg-surface-2/40 px-4 py-2 text-xs leading-relaxed text-muted">{t('footer')}</p>
    </div>
  );
}
