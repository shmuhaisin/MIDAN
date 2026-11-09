'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { saveJob } from '@/lib/candidate-actions';
import { Icon } from './icons';

/** Saves a job to the candidate's list. Sits above the row's full-size link, so it stays clickable. */
export function SaveJobButton({ jobId, title, saved: initial, compact = false }: { jobId: string; title: string; saved: boolean; compact?: boolean }) {
  const t = useTranslations('jobs');
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button" disabled={pending} aria-pressed={saved} aria-busy={pending}
      aria-label={saved ? t('unsaveNamed', { job: title }) : t('saveNamed', { job: title })}
      onClick={() => start(async () => {
        const r = await saveJob(jobId, !saved);
        setFailed(Boolean(r.error));
        if (!r.error) setSaved(!saved);
      })}
      className={`relative z-10 inline-flex items-center gap-1.5 text-sm font-semibold ${saved ? 'text-primary' : 'text-muted hover:text-foreground'} ${compact ? '' : 'btn btn-secondary btn-sm'}`}
    >
      <Icon name={saved ? 'check' : 'bookmark'} className="size-4" />
      {failed ? t('saveFailed') : saved ? t('saved') : t('save')}
    </button>
  );
}
