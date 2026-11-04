import { redirect } from 'next/navigation';

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ as?: string }> }) {
  const { locale } = await params;
  const kind = (await searchParams).as === 'organization' ? 'organization' : 'candidate';
  redirect(`/${locale}/register?as=${kind}`);
}
