import { getTranslations } from 'next-intl/server';
export default async function Loading() { const t = await getTranslations('members'); return <p role="status" className="p-12">{t('working')}</p>; }
