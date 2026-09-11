/** A small, consistent icon set drawn inline. No icon font, no CDN. */
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  check: 'M20 6 9 17l-5-5',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2.1 2.1 0 0 1-3-3z',
  hammer: 'M15 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9M17.6 3.6l2.8 2.8-4.2 4.2-2.8-2.8z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  can: 'M6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 8a6 2.5 0 0 1 12 0',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  toolbox: 'M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 9V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3M3 13h18',
  paw: 'M5.5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.5 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM14.5 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 21c3 0 5-1.6 5-3.6S15 13 12 13s-5 2.4-5 4.4S9 21 12 21z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  calendar: 'M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 3v4M16 3v4M4 11h16',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.2 7.5a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V1.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M18 6 6 18M6 6l12 12',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  repeat: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  chart: 'M3 3v18h18M7 15v3M12 9v9M17 5v13',
  stethoscope: 'M6 3v6a5 5 0 0 0 10 0V3M4 3h4M14 3h4M16 14v2a4 4 0 0 1-8 0M19 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7zM8 8l8 8',
  heart: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.4l8.8-8.7a5 5 0 0 0 0-7.1z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  battery: 'M3 8h14v8H3zM20 11v2M6 11v2M9 11v2',
  handshake: 'M11 17l2 2 4-4 4 4M3 12l4-4 4 4-4 4zM7 8l4-4 4 4',
  tag: 'M20.6 13.4 12 22l-9-9V4h9zM7.5 8.5h.01',
  bank: 'M3 21h18M4 10v8M9 10v8M15 10v8M20 10v8M12 2 2 8h20z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14',
  edit: 'M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  book: 'M4 4v15a2 2 0 0 0 2 2h14V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h14',
  cpu: 'M5 5h14v14H5zM9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  filter: 'M3 4h18l-7 8v7l-4 2v-9z',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  undo: 'M3 7v6h6M3.5 13a9 9 0 1 0 2.1-5.6L3 10',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  leaf: 'M4 20c0-8 5-13 16-13 0 9-5 13-11 13H4zM4 20c2-5 5-8 9-10',
  sprout: 'M12 21v-8M12 13c0-3-2-5-5-5H4c0 3 2 5 5 5zM12 13c0-4 2-6 5-6h3c0 4-2 6-5 6z',
  recycle: 'M7 19H4.8a2 2 0 0 1-1.7-3l2.3-4M12 4.5l2.2 3.8M17 19h2.2a2 2 0 0 0 1.7-3l-3.3-5.7M9.4 8.3 7.2 12M14 19H9M10.5 21l-2-2 2-2M6.2 8.6l.7 2.8 2.8-.7M17.8 11.4l-2.8.7-.7-2.8',
};

export type IconName = keyof typeof PATHS | string;

export function Icon({ name, size = 16, className = '', strokeWidth = 1.8 }: {
  name: IconName; size?: number; className?: string; strokeWidth?: number;
}) {
  const d = PATHS[name] ?? PATHS.circle!;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
