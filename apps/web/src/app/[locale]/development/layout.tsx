import { CareerNav } from '@/components/career-client';
import { candidateOnly } from '@/lib/account';

/** The career workspace: its own places under the candidate's navigation, the same on every page of the journey. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  await candidateOnly((await params).locale);
  return (
    <>
      <div className="container-page pt-6"><CareerNav /></div>
      {children}
    </>
  );
}
