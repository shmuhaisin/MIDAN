import { Skeleton } from '@/components/ui';

/** Holds the shape of a working page (title, a figure row, a list) so nothing jumps when the data arrives. */
export default function Loading() {
  return (
    <div className="container-page space-y-8 py-10" aria-busy="true" aria-live="polite">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-border bg-border lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 bg-surface p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-14" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-border rounded-[var(--radius-panel)] border border-border bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 p-5">
            <Skeleton className="size-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
