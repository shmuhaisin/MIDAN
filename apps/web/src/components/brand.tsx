import clsx from 'clsx';
import Image from 'next/image';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { HUMAIDAN_FILES, safeVariant, type HumaidanVariant } from '@/lib/humaidan';

/** The one way to show Humaidan: the full figure, the original files, and Original if a variant isn't recognized. */
export function Humaidan({
  outfit = 'original',
  sizes,
  priority,
  idle,
  className,
}: {
  outfit?: HumaidanVariant;
  sizes: string;
  priority?: boolean;
  idle?: boolean;
  className?: string;
}) {
  const t = useTranslations('humaidanAlt');
  const variant = safeVariant(outfit);
  return (
    <span className={clsx('relative block aspect-[3/4]', idle && 'humaidan-idle', className)}>
      <Image
        src={`/assets/humaidan/${HUMAIDAN_FILES[variant]}`}
        alt={t(variant)}
        fill
        sizes={sizes}
        loading={priority ? 'eager' : undefined}
        className="object-contain object-bottom"
      />
    </span>
  );
}

/** Original parapet frieze inspired by Najdi merlons with their triangular openings. */
export function Parapet({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden className={clsx('block h-9 w-full', className)} preserveAspectRatio="none">
      <defs>
        <pattern id={id} width="48" height="36" patternUnits="userSpaceOnUse">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M0 36V24h6v-8h6V8h6V0h12v8h6v8h6v8h6v12zM24 14l7 13H17z"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Faint repeating triangles for deep surfaces. */
export function TriangleField({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden className={clsx('pointer-events-none absolute inset-0 h-full w-full', className)}>
      <defs>
        <pattern id={id} width="44" height="38" patternUnits="userSpaceOnUse">
          <path d="M22 4l15 26H7z" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * The approved logo. Set only its height: the width follows from the artwork's proportions.
 * Pass `decorative` when the platform name sits beside it, so screen readers don't hear the name twice.
 */
export function Logo({ className, decorative, priority, sizes = '160px' }: { className?: string; decorative?: boolean; priority?: boolean; sizes?: string }) {
  return (
    <Image
      src="/assets/brand/midan-logo.png" width={1385} height={758} sizes={sizes} priority={priority}
      alt={decorative ? '' : 'الميدان — MIDAN'}
      className={clsx('h-10 w-auto max-w-full object-contain', className)}
    />
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx('size-4 shrink-0 rtl:-scale-x-100', className)}
    >
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

/** A person's or a job's path through Midan, computed from real state. */
export function JourneyRail({ label, steps, done }: { label: string; steps: string[]; done: boolean[] }) {
  const current = done.indexOf(false);
  return (
    <ol aria-label={label} className="flex gap-1 overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <li key={step} aria-current={i === current ? 'step' : undefined} className="min-w-24 flex-1">
          <span className={clsx('block h-1.5 rounded-full', done[i] ? 'bg-primary' : i === current ? 'bg-gold' : 'bg-surface-2')} />
          <span className={clsx('mt-1.5 block text-xs leading-snug', i === current ? 'font-semibold' : 'text-muted')}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={clsx('flex items-center gap-3 text-sm font-medium', className)}>
      <span aria-hidden className="h-px w-8 bg-gold" />
      {children}
    </p>
  );
}
