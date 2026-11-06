'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/**
 * Daily Prebuilt embedded in the page. Prebuilt provides the pre-join camera and microphone check, the call controls,
 * screen sharing and participant list. It's loaded only when someone joins. Recording is never started from here.
 */
export function DailyRoom({ url, token, onLeft }: { url: string; token: string; onLeft: () => void }) {
  const t = useTranslations('interview');
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'interrupted' | 'failed'>('loading');

  useEffect(() => {
    let frame: { destroy: () => Promise<void>; on: (event: string, handler: () => void) => unknown; join: (o: { url: string; token: string }) => Promise<unknown> } | undefined;
    let gone = false;
    (async () => {
      try {
        const { default: Daily } = await import('@daily-co/daily-js');
        if (gone || !holder.current) return;
        frame = Daily.createFrame(holder.current, {
          showLeaveButton: true,
          showFullscreenButton: true,
          iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '0.5rem' },
        }) as unknown as typeof frame;
        frame?.on('joined-meeting', () => setState('ready'));
        frame?.on('left-meeting', onLeft);
        frame?.on('network-connection', () => setState((s) => (s === 'loading' ? s : 'ready')));
        frame?.on('error', () => setState('interrupted'));
        await frame?.join({ url, token });
        setState('ready');
      } catch {
        if (!gone) setState('failed');
      }
    })();
    return () => {
      gone = true;
      frame?.destroy().catch(() => undefined);
    };
  }, [url, token, onLeft]);

  return (
    <div>
      {state === 'loading' && <p role="status" className="mb-2 text-sm text-muted">{t('connecting')}</p>}
      {state === 'interrupted' && <p role="alert" className="mb-2 rounded-lg border-s-2 border-error bg-surface-2 p-3 text-sm">{t('interrupted')}</p>}
      {state === 'failed' && <p role="alert" className="mb-2 rounded-lg border-s-2 border-error bg-surface-2 p-3 text-sm">{t('callFailed')}</p>}
      <div ref={holder} className="h-[70vh] min-h-[28rem] w-full overflow-hidden rounded-lg bg-deep" />
      {state !== 'loading' && state !== 'ready' && <button type="button" onClick={onLeft} className="mt-3 font-semibold underline underline-offset-4">{t('rejoin')}</button>}
    </div>
  );
}
