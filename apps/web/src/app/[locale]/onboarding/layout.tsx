import { candidateOnly } from '@/lib/account';

/** A candidate page: organization accounts go to their workspace instead. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  await candidateOnly((await params).locale);
  return children;
}
