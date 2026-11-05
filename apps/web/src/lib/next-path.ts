/** Only a path inside this site may be returned to after signing in. */
export function safeNext(value: unknown): string | undefined {
  const next = typeof value === 'string' ? value : '';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) return undefined;
  // Links arrive with the language in front, and redirects add it again.
  return next.replace(/^\/(ar|en)(?=\/|$)/, '') || '/';
}
