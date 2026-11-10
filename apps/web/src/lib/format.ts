/**
 * The locale every number and date is formatted with. MIDAN always shows English (Latin) digits 0–9, in Arabic too
 * (owner's requirement, 2026-11-10): `nu-latn` asks for them explicitly, because `ar-SA` defaults to Arabic-Indic digits
 * and browsers differ on plain `ar`. The Gregorian calendar is kept for Arabic. `english` keeps a screen's existing
 * English style ('en' month-day, 'en-GB' day-month).
 */
export function intlLocale(locale: string, english: 'en' | 'en-GB' = 'en') {
  return locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : english;
}

export function number(locale: string, value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** One part or style of a date in a given zone (day, month, time…), with English digits in both languages. */
export function datePart(locale: string, value: string | Date, timeZone: string, options: Intl.DateTimeFormatOptions, english: 'en' | 'en-GB' = 'en') {
  return new Intl.DateTimeFormat(intlLocale(locale, english), { timeZone, ...options }).format(new Date(value));
}

export function pick(locale: string, ar: string, en: string) {
  return locale === 'ar' ? ar : en;
}

export function list(locale: string, items: string[]) {
  return items.join(locale === 'ar' ? '، ' : ', ');
}

/** True when white text meets the 4.5:1 contrast minimum on this color. */
export function readableOnWhite(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05) >= 4.5;
}

const INTL_LOCALE = (locale: string) => intlLocale(locale, 'en-GB');

/** Stored in UTC everywhere, shown in the person's own zone. Passing the zone keeps server and browser in agreement. */
export function formatWhen(locale: string, value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat(INTL_LOCALE(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export function formatDate(locale: string, value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat(INTL_LOCALE(locale), { dateStyle: 'medium', timeZone }).format(new Date(value));
}
