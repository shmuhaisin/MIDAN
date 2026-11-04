export function number(locale: string, value: number) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en').format(value);
}
