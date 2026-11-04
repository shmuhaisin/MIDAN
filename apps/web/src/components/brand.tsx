import clsx from 'clsx';
import Image from 'next/image';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

const OUTFITS = {
  original: '01_Humaidan_Original.png',
  finance: '02_Humaidan_Finance.png',
  legal: '03_Humaidan_Legal_Brown_Bisht.png',
  engineering: '04_Humaidan_Engineering.png',
  tech: '05_Humaidan_Tech_Cybersecurity.png',
  events: '06_Humaidan_Entertainment_Events.png',
  healthcare: '07_Humaidan_Healthcare.png',
} as const;

export type Outfit = keyof typeof OUTFITS;

/** Always the full figure: object-contain inside a portrait box, so the shemagh is never cropped. */
export function Humaidan({
  outfit = 'original',
  sizes,
  priority,
  className,
}: {
  outfit?: Outfit;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const t = useTranslations('humaidanAlt');
  return (
    <span className={clsx('relative block aspect-[3/4]', className)}>
      <Image
        src={`/assets/humaidan/${OUTFITS[outfit]}`}
        alt={t(outfit)}
        fill
        sizes={sizes}
        priority={priority}
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

export function Mark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={clsx('size-7', className)}>
      <path fill="var(--primary)" d="M2 30V20h5v-6h5V8h8v6h5v6h5v10z" />
      <path fill="var(--gold)" d="M16 13l5 9H11z" />
    </svg>
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

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={clsx('flex items-center gap-3 text-sm font-medium', className)}>
      <span aria-hidden className="h-px w-8 bg-gold" />
      {children}
    </p>
  );
}
