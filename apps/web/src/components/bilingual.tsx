'use client';

// A pair of fields, Arabic and English, that translate each other as the employer types (employer brief, section 7).
// About a second after typing stops, the other field is filled by the live model, but only if it is empty or was filled
// by translation and not edited since. What the employer wrote or saved before is never replaced automatically; "Translate
// from Arabic/English" does it on request. Both fields are ordinary form fields, saved independently with the form.
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { DEBOUNCE_MS, canApply, originOf, other, shouldTranslate, type Lang, type Origin } from '@/lib/translation';
import { translateField } from '@/lib/translation-actions';
// The shared input class (forms.tsx INPUT); not imported, because forms.tsx imports this file.
const INPUT = 'input';

type Status = { state: 'idle' } | { state: 'translating'; target: Lang } | { state: 'done'; target: Lang } | { state: 'failed'; target: Lang; reason: string };

export function BilingualPair({
  orgId, field, labels, defaults, multiline = false, rows = 4, required = false, maxLength, hint, disabled = false,
}: {
  orgId: string;
  /** The form names are `${field}_ar` and `${field}_en`. */
  field: string;
  labels: Record<Lang, string>;
  defaults?: Partial<Record<Lang, string | null>>;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  hint?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('bilingual');
  const id = useId();
  const [values, setValues] = useState<Record<Lang, string>>({ ar: defaults?.ar ?? '', en: defaults?.en ?? '' });
  const [origins, setOrigins] = useState<Record<Lang, Origin>>({ ar: originOf(defaults?.ar), en: originOf(defaults?.en) });
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  // Refs hold what the timer and late replies must see now, not what they saw when they were scheduled.
  const live = useRef({ values, origins, focused: null as Lang | null });
  live.current.values = values;
  live.current.origins = origins;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sequence = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function run(source: Lang, explicit: boolean) {
    const target = other(source);
    const text = live.current.values[source];
    if (!explicit && !shouldTranslate({ sourceText: text, targetOrigin: live.current.origins[target], targetFocused: live.current.focused === target })) return;
    const mine = ++sequence.current;
    setStatus({ state: 'translating', target });
    const result = await translateField(orgId, field, source, target, text);
    if (mine !== sequence.current) return; // a newer request replaced this one
    if (!result.text) {
      setStatus({ state: 'failed', target, reason: result.reason ?? 'unavailable' });
      return;
    }
    if (!canApply({ requestedText: text, currentSourceText: live.current.values[source], targetOrigin: live.current.origins[target], explicit })) {
      setStatus({ state: 'idle' });
      return;
    }
    const translated = maxLength ? result.text.slice(0, maxLength) : result.text;
    setValues((v) => ({ ...v, [target]: translated }));
    setOrigins((o) => ({ ...o, [target]: 'auto' }));
    setStatus({ state: 'done', target });
  }

  function change(lang: Lang, value: string) {
    setValues((v) => ({ ...v, [lang]: value }));
    setOrigins((o) => ({ ...o, [lang]: value.trim() ? 'manual' : 'empty' }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(lang, false), DEBOUNCE_MS);
  }

  const busy = status.state === 'translating';
  const describe = (lang: Lang) => [hint ? `${id}-hint` : '', `${id}-${lang}-status`].filter(Boolean).join(' ');

  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      {(['ar', 'en'] as const).map((lang) => {
        const from = other(lang);
        const props = {
          id: `${id}-${lang}`, name: `${field}_${lang}`, value: values[lang], dir: lang === 'ar' ? 'rtl' : 'ltr', required, maxLength, disabled,
          'aria-describedby': describe(lang), 'aria-busy': busy && status.target === lang,
          onFocus: () => { live.current.focused = lang; },
          onBlur: () => { live.current.focused = null; },
          className: clsx(INPUT, multiline && 'h-auto py-2.5 leading-relaxed', origins[lang] === 'auto' && 'bg-mint/8'),
        };
        return (
          <div key={lang} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`${id}-${lang}`} className="field-label">{labels[lang]}</label>
              {!disabled && values[from].trim().length >= 2 && (
                <button type="button" className="link shrink-0 text-xs disabled:opacity-60" disabled={busy} onClick={() => { clearTimeout(timer.current); void run(from, true); }}>
                  {t(from === 'ar' ? 'fromArabic' : 'fromEnglish')}
                </button>
              )}
            </div>
            {multiline
              ? <textarea rows={rows} {...props} onChange={(e) => change(lang, e.target.value)} />
              : <input {...props} onChange={(e) => change(lang, e.target.value)} />}
            <p id={`${id}-${lang}-status`} aria-live="polite" className="mt-1 min-h-4 text-xs text-muted">
              {status.state === 'translating' && status.target === lang && t('translating')}
              {status.state === 'done' && status.target === lang && origins[lang] === 'auto' && t('translated')}
              {status.state === 'failed' && status.target === lang && t(`failed.${['not_configured', 'quota_exhausted', 'rate_limited', 'timeout'].includes(status.reason) ? status.reason : 'other'}`)}
            </p>
          </div>
        );
      })}
      {hint && <p id={`${id}-hint`} className="-mt-3 text-xs text-muted sm:col-span-2">{hint}</p>}
    </div>
  );
}
