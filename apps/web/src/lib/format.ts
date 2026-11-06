export function number(locale: string, value: number) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en').format(value);
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

const INTL_LOCALE = (locale: string) => (locale === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB');

/** Stored in UTC everywhere, shown in the person's own zone. Passing the zone keeps server and browser in agreement. */
export function formatWhen(locale: string, value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat(INTL_LOCALE(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export function formatDate(locale: string, value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat(INTL_LOCALE(locale), { dateStyle: 'medium', timeZone }).format(new Date(value));
}
