/**
 * The Content-Security-Policy for every page, built per request by src/proxy.ts. Scripts need this request's nonce, which
 * Next.js puts on its own scripts and the layout passes to the theme script; anything they load is allowed through
 * 'strict-dynamic'. What else the pages genuinely use:
 * - styles: React renders style attributes, which a nonce can't cover, so inline styles stay allowed (scripts don't);
 * - images: our own files, data and blob URLs, and organization logos from Supabase Storage's public bucket;
 * - frames: interviews embed Daily Prebuilt (components/daily-room.tsx), which daily-js talks to;
 * - forms: server actions post to this site. Google sign-in goes on to Supabase Auth and then Google, and browsers apply
 *   form-action to each redirect of a form post, which is what a click before hydration or without JavaScript makes.
 * Development adds what React's debugging needs: 'unsafe-eval'.
 */
export function contentSecurityPolicy({ nonce, supabaseUrl, dev = false, https = false }: { nonce: string; supabaseUrl?: string; dev?: boolean; https?: boolean }) {
  const supabase = originOf(supabaseUrl);
  const daily = 'https://*.daily.co';
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', ...(supabase ? [supabase] : [])],
    ['font-src', "'self'", 'data:'],
    // The browser never calls Supabase or the API itself: the Next.js server does.
    ['connect-src', "'self'", daily, 'wss://*.daily.co'],
    ['frame-src', daily],
    ['media-src', "'self'", 'blob:'],
    ['worker-src', "'self'", 'blob:'],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'", ...(supabase ? [supabase] : []), 'https://accounts.google.com'],
    ['frame-ancestors', "'none'"],
  ];
  return [...directives.map((d) => d.join(' ')), ...(https ? ['upgrade-insecure-requests'] : [])].join('; ');
}

/** A random, single-use value, as the CSP nonce must be. */
export function newNonce() {
  return btoa(crypto.randomUUID());
}

function originOf(url?: string) {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}
