/** Calls Supabase Storage with the signed-in person's own token, so storage policies decide. */
export function storageFetch(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/${path}`, {
    ...init,
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '', authorization: token, ...init.headers },
  });
}

/** A short-lived link, or null if this person isn't allowed the file. */
export async function signedUrl(bucket: string, path: string, token: string, expiresIn = 300) {
  const response = await storageFetch(`object/sign/${bucket}/${path}`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) return null;
  const { signedURL } = (await response.json()) as { signedURL: string };
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${signedURL}`;
}
