import { cache } from 'react';
import { notFound } from 'next/navigation';
import { apiForPage } from './api';

/**
 * Every admin layout and page awaits this before it reads anything privileged. Next.js renders a layout and its page
 * concurrently, so the layout's check alone doesn't stop a page's own data requests from going out; with this, a page
 * never requests admin data for someone who isn't a platform administrator, in development and in production alike.
 * Signed out: apiForPage sends the person to sign in. Signed in but not an administrator: not found. cache() makes it one
 * API call per request however many components ask. The security boundary stays the API's PlatformAdminGuard and the
 * database's private.platform_admins; this only decides what the page renders.
 */
export const requirePlatformAdmin = cache(async (): Promise<void> => {
  const session = await apiForPage<{ ok?: boolean }>('/admin/session');
  if (session?.ok !== true) notFound();
});
