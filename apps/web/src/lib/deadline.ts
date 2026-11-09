/** Where a job stands against its application deadline: a date, in Riyadh time, inclusive (the database enforces it). */
export type DeadlineState = 'open' | 'closing_soon' | 'closed';

export const CLOSING_SOON_DAYS = 7;

/** Today in Riyadh as YYYY-MM-DD. `now` is injectable for tests. */
export function riyadhToday(now = Date.now()) {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export function deadlineState(deadline: string | null | undefined, now = Date.now()): DeadlineState | null {
  if (!deadline) return null;
  const day = deadline.slice(0, 10);
  const today = riyadhToday(now);
  if (day < today) return 'closed';
  const days = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= CLOSING_SOON_DAYS ? 'closing_soon' : 'open';
}
