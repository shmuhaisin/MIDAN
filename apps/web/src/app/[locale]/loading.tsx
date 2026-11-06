export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-4 px-4 py-8 sm:px-6" aria-busy="true">
      <div className="h-7 w-52 rounded bg-surface-2" />
      <div className="h-4 w-80 max-w-full rounded bg-surface-2" />
      <div className="h-28 rounded-lg bg-surface-2" />
      <div className="h-28 rounded-lg bg-surface-2" />
    </div>
  );
}
