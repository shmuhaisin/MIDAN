/**
 * Interview times are entered and shown as wall-clock time in one zone (MIDAN's is Asia/Riyadh), whatever zone the
 * person's browser is in. A `datetime-local` value ("2026-11-12T10:30") has no zone: `new Date(value)` would read it in
 * the browser's own zone and save the wrong instant for anyone outside Riyadh. These convert explicitly.
 */
export const INTERVIEW_ZONE = 'Asia/Riyadh';

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The zone's offset from UTC, in minutes, at one instant (Riyadh is +180 all year; other zones may observe DST). */
function offsetMinutes(instant: Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "2026-11-12T10:30" read as wall-clock time in `zone`, as an ISO instant; null when the value isn't a date and time. */
export function zonedLocalToIso(value: string, zone = INTERVIEW_ZONE): string | null {
  const m = LOCAL.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  if (Number.isNaN(guess)) return null;
  // Two passes settle the offset even across a DST change in zones that have one.
  let instant = guess - offsetMinutes(new Date(guess), zone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant).toISOString();
}

/** An ISO instant as the `datetime-local` value it shows in `zone` ("2026-11-12T10:30"). */
export function isoToZonedLocal(iso: string, zone = INTERVIEW_ZONE): string {
  const instant = new Date(iso);
  const shifted = new Date(instant.getTime() + offsetMinutes(instant, zone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}
