import clsx from 'clsx';

/**
 * MIDAN's icon set: 20px grid, 1.6 stroke, round joins. Decorative by default (aria-hidden); the control that holds an
 * icon carries the accessible name. Directional icons flip in RTL.
 */
const PATHS = {
  home: 'M3.5 9.5 10 4l6.5 5.5V16a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z',
  briefcase: 'M3 7.5h14v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM7 7.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M3 11.5h14',
  growth: 'M3.5 16.5 8 12l3 3 5.5-6.5M12.5 8.5h4v4',
  bell: 'M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13zM8.5 17.5a1.6 1.6 0 0 0 3 0',
  user: 'M10 10a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5zM3.5 17c.8-3 3.3-4.5 6.5-4.5s5.7 1.5 6.5 4.5',
  settings: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  building: 'M4 17V4.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V17M12 8h3a1 1 0 0 1 1 1v8M2.5 17h15M7 7h2M7 10h2M7 13h2',
  users: 'M7.5 9.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM2.5 16.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4M13 4.2a2.75 2.75 0 0 1 0 5.1M14.5 12.7c1.5.5 2.6 1.8 3 3.8',
  layers: 'M10 3 2.5 7 10 11l7.5-4zM2.5 10.5 10 14.5l7.5-4M2.5 14l7.5 4 7.5-4',
  calendar: 'M3.5 5.5h13v11h-13zM3.5 9h13M7 3.5v3M13 3.5v3',
  check: 'M4.5 10.5 8 14l7.5-8',
  bookmark: 'M6 3.5h8v13L10 13.5l-4 3v-13Z',
  shield: 'M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z',
  list: 'M7 5.5h9.5M7 10h9.5M7 14.5h9.5M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.8-3.8',
  file: 'M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5zM11.5 2.5v4h4M7.5 10.5h5M7.5 13.5h5',
  inbox: 'M3 11.5 5 4.5h10l2 7v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 11.5h4l1 2h4l1-2h4',
  clock: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 6v4.5l3 1.5',
  logout: 'M8 3.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H8M13 13.5 16.5 10 13 6.5M16.5 10H7.5',
  menu: 'M3 6h14M3 10h14M3 14h14',
  close: 'M5 5l10 10M15 5L5 15',
  globe: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM2.5 10h15M10 2.5c2 2 3 4.6 3 7.5s-1 5.5-3 7.5c-2-2-3-4.6-3-7.5s1-5.5 3-7.5z',
  external: 'M11.5 3.5h5v5M16.5 3.5l-7 7M14.5 11.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4',
  chevron: 'M7.5 4.5 13 10l-5.5 5.5',
} as const;

const DIRECTIONAL = new Set<keyof typeof PATHS>(['chevron', 'logout']);

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      // The default size applies only when the caller sets none: two size utilities would race on stylesheet order.
      className={clsx(!/(^|\s)size-/.test(className ?? '') && 'size-5', 'shrink-0', DIRECTIONAL.has(name) && 'rtl:-scale-x-100', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
