import { useTranslations } from 'next-intl';
import type { HumaidanVariant } from '@/lib/humaidan';
import { Eyebrow, Humaidan } from './brand';
import { Reveal } from './interactive';

export function PageHero({ ns, outfit }: { ns: string; outfit?: HumaidanVariant }) {
  const t = useTranslations(ns);
  return (
    <section className="mx-auto grid max-w-7xl items-end gap-6 px-4 pt-12 sm:px-6 lg:grid-cols-12 lg:pt-16">
      <div className="pb-10 lg:col-span-8 lg:pb-16">
        <Eyebrow className="text-muted">{t('eyebrow')}</Eyebrow>
        <h1 className="mt-5 font-display text-4xl leading-[1.15] font-bold sm:text-6xl">{t('title')}</h1>
        {t.has('lead') && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{t('lead')}</p>}
      </div>
      {outfit && (
        <div className="mx-auto w-48 sm:w-56 lg:col-span-4 lg:ms-auto lg:me-0 lg:w-64">
          <Humaidan outfit={outfit} sizes="256px" priority />
        </div>
      )}
    </section>
  );
}

export function PointList({ points }: { points: { title: string; body: string }[] }) {
  return (
    <div className="grid border-t border-border md:grid-cols-2">
      {points.map((p, i) => (
        <Reveal key={p.title} delay={i * 0.05} className="border-b border-border py-8 md:odd:border-e md:odd:pe-10 md:even:ps-10">
          <h2 className="font-display text-2xl font-semibold">{p.title}</h2>
          <p className="mt-2 text-lg leading-relaxed text-muted">{p.body}</p>
        </Reveal>
      ))}
    </div>
  );
}
