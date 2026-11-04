export function number(locale: string, value: number) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en').format(value);
}

export function pick(locale: string, ar: string, en: string) {
  return locale === 'ar' ? ar : en;
}
