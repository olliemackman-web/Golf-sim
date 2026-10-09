// Inline stroke icons (24x24).
const P: Record<string, string> = {
  range: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  course: '<path d="M6 21V3"/><path d="M6 4l11 3.5L6 11"/><ellipse cx="12" cy="20" rx="8" ry="2"/>',
  hole: '<path d="M12 21V4"/><path d="M12 4l7 3-7 3"/><circle cx="12" cy="21" r="1"/><path d="M4 18c3-2 13-2 16 0"/>',
  building: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  scenery: '<circle cx="12" cy="9" r="3"/><path d="M12 12v9"/><path d="M12 6V3M9 9H6M15 9h3M9.9 6.9 8 5M14.1 6.9 16 5"/><path d="M8 17c1.5 0 3 1 4 2 1-1 2.5-2 4-2"/>',
  tree: '<path d="M12 21v-5"/><path d="M12 3l6 8h-3l4 5H5l4-5H6z"/>',
  landscape: '<path d="M2 19l6-9 4 5 3-4 7 8z"/><circle cx="17" cy="6" r="2"/>',
  land: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  bulldoze: '<path d="M3 17h11l2-5H7l-2 5"/><circle cx="6" cy="19" r="1.5"/><circle cx="12" cy="19" r="1.5"/><path d="M16 12l3-4 2 1-2 8"/>',
  finance: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  visitors: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c3 .2 5.5 2.4 5.5 5.8"/>',
  staff: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 18c.8-2.3 2.5-3.5 4.5-3.5s3.7 1.2 4.5 3.5"/>',
  research: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7 15h10"/>',
  marketing: '<path d="M3 11v3l11 5V6L3 11z"/><path d="M14 9a4 4 0 0 1 0 6"/><path d="M6 14.5l1 4.5h3l-1-3.5"/>',
  prices: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.5"/>',
  trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  golfer: '<circle cx="9" cy="4.5" r="2"/><path d="M9 7v7l-3 7M9 14l3 7"/><path d="M9 9l5 2 6-7"/><circle cx="17" cy="20" r="1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  ff: '<path d="M4 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.2 1.6 2.5 2 2.5.8 2.5 2-1.1 2.1-2.5 2.1c-1.1 0-2.1-.6-2.6-1.6M12 6v1.6M12 16.4V18"/>',
  sunny: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partly: '<path d="M8 5.5A4 4 0 0 1 15.5 7"/><path d="M8 3v1M3.5 7.5h1M4.8 4.3l.7.7"/><path d="M7 19h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 19z"/>',
  overcast: '<path d="M6 19h11a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 6 19z"/>',
  rain: '<path d="M6 15h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.5 2A3 3 0 0 0 6 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  storm: '<path d="M6 14h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.5 2A3 3 0 0 0 6 14z"/><path d="M12 14l-2 4h3l-2 4"/>',
  arrow: '<path d="M12 21V4M5 10l7-7 7 7"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  cart: '<rect x="3" y="9" width="15" height="7" rx="2"/><path d="M6 9V5h10l2 4"/><circle cx="7" cy="18" r="2"/><circle cx="15" cy="18" r="2"/><path d="M18 12h3"/>',
  ball: '<circle cx="12" cy="12" r="8"/><circle cx="10" cy="9" r=".8" fill="currentColor"/><circle cx="14" cy="10" r=".8" fill="currentColor"/><circle cx="11" cy="13" r=".8" fill="currentColor"/><circle cx="15" cy="14" r=".8" fill="currentColor"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  paint: '<path d="M4 20c2 0 4-1 4-3a2 2 0 1 0-4 0c0 1-1 2-2 2"/><path d="M8 15l11-11 2 2L10 17"/>',
  terrain: '<path d="M3 18l5-7 3 4 4-6 6 9z"/>',
  raise: '<path d="M4 19h16"/><path d="M12 15V5M8 9l4-4 4 4"/>',
  lower: '<path d="M4 5h16"/><path d="M12 9v10M8 15l4 4 4-4"/>',
  flatten: '<path d="M3 14h18"/><path d="M6 10c2-3 4-3 6 0s4 3 6 0"/>',
  smooth: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/>',
  flag: '<path d="M6 21V3l12 4-12 5"/>',
  pin: '<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  tee: '<path d="M8 6h8l-3 3v11h-2V9z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

export function icon(name: string, cls = ''): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.info}</svg>`;
}

/** Club crest badge (SVG). */
export function crest(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6b46"/><stop offset="1" stop-color="#173825"/></linearGradient>
  <linearGradient id="cb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d991"/><stop offset="1" stop-color="#b48a39"/></linearGradient></defs>
  <path d="M32 3l24 8v19c0 15-10 25-24 31C18 55 8 45 8 30V11z" fill="url(#cg)" stroke="url(#cb)" stroke-width="3"/>
  <path d="M27 46V16" stroke="#f3ead3" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M27 17l14 5-14 5z" fill="#e5735f"/>
  <ellipse cx="32" cy="46.5" rx="12" ry="3" fill="#7cc561" opacity=".9"/>
  <circle cx="37" cy="45.5" r="2" fill="#fff"/>
  </svg>`;
}
