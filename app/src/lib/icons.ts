// Small hand-rolled icon set (stroke-based, 20x20 viewBox) used across the redesigned
// sidebar, composer and message-action rows. Kept as plain SVG strings so any part of
// the app can drop one into innerHTML without pulling in an icon library dependency.

function svg(inner: string, viewBox = "0 0 20 20"): string {
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

export const icons = {
  // Sidebar panel toggle (open/close)
  panel: svg(
    `<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><line x1="8" y1="3.5" x2="8" y2="16.5"/>`
  ),
  search: svg(`<circle cx="8.5" cy="8.5" r="5.5"/><line x1="17" y1="17" x2="12.6" y2="12.6"/>`),
  plus: svg(`<line x1="10" y1="3.5" x2="10" y2="16.5"/><line x1="3.5" y1="10" x2="16.5" y2="10"/>`),
  close: svg(`<line x1="4.5" y1="4.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="4.5" x2="4.5" y2="15.5"/>`),
  send: svg(`<line x1="10" y1="16" x2="10" y2="4.2"/><path d="M4.5 9.5 10 4l5.5 5.5"/>`),
  mic: svg(
    `<rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4 9.5a6 6 0 0 0 12 0"/><line x1="10" y1="15.5" x2="10" y2="18"/><line x1="7" y1="18" x2="13" y2="18"/>`
  ),
  micOff: svg(
    `<rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4 9.5a6 6 0 0 0 12 0"/><line x1="10" y1="15.5" x2="10" y2="18"/><line x1="7" y1="18" x2="13" y2="18"/><line x1="2.5" y1="2.5" x2="17.5" y2="17.5" stroke="var(--danger,#e0554f)"/>`
  ),
  paperclip: svg(
    `<path d="M12.5 3.5 5.8 10.2a3 3 0 0 0 4.2 4.2l6.4-6.4a5 5 0 0 0-7-7L3 7.4"/>`
  ),
  image: svg(
    `<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><circle cx="7" cy="8" r="1.4"/><path d="M17 13.5 13 9.5 5.5 17"/>`
  ),
  ruler: svg(
    `<path d="M3 7h14v6H3z"/><path d="M6 7v3M9 7v2M12 7v3M15 7v2"/>`
  ),
  scissors: svg(
    `<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="14" r="2.2"/><path d="M8 7.5 16.5 16M8 12.5 16.5 4"/>`
  ),
  calc: svg(
    `<rect x="3.5" y="2.5" width="13" height="15" rx="2"/><path d="M6.5 6h7M6.5 9.5h2M11.5 9.5h2M6.5 13h2M11.5 13h2"/>`
  ),
  weather: svg(
    `<circle cx="8" cy="8" r="3"/><path d="M8 2.5v1.5M8 16v1.5M2.5 8H4M16 8h1.5M4.2 4.2l1 1M14.8 14.8l1 1M14.8 4.2l-1 1M4.2 14.8l1-1"/>`
  ),
  slab: svg(
    `<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 9h15"/>`
  ),
  tools: svg(
    `<path d="M12.3 4.2a3.4 3.4 0 0 0-4.6 4l-6 6 2.2 2.2 6-6a3.4 3.4 0 0 0 4-4.6l-2.5 2.5-1.6-1.6z"/>`
  ),
  copy: svg(
    `<rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M4.5 12.5h-1a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1"/>`
  ),
  check: svg(`<path d="M4 10.5 8 14.5 16 5.5"/>`),
  volume: svg(
    `<path d="M3 7.5h3l4.5-3.5v12L6 12.5H3z"/><path d="M13 7a4 4 0 0 1 0 6"/><path d="M15.3 4.7a8 8 0 0 1 0 10.6"/>`
  ),
  volumeOff: svg(
    `<path d="M3 7.5h3l4.5-3.5v12L6 12.5H3z"/><line x1="13" y1="7" x2="17" y2="13"/><line x1="17" y1="7" x2="13" y2="13"/>`
  ),
  thumbUp: svg(
    `<path d="M7.5 8.5v8H5a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 5 8.5h2.5Zm0 0 2.7-5.4a1.6 1.6 0 0 1 3 .7v3.2H14a1.6 1.6 0 0 1 1.55 2L14.4 14a2 2 0 0 1-1.9 1.4H7.5"/>`
  ),
  thumbDown: svg(
    `<path d="M12.5 11.5v-8H15a1.5 1.5 0 0 1 1.5 1.5V10a1.5 1.5 0 0 1-1.5 1.5h-2.5Zm0 0-2.7 5.4a1.6 1.6 0 0 1-3-.7v-3.2H5.5a1.6 1.6 0 0 1-1.55-2L5.1 6a2 2 0 0 1 1.9-1.4h5.5"/>`
  ),
  retry: svg(
    `<path d="M4 10a6 6 0 0 1 10.2-4.2L16 7.5"/><path d="M16 4v3.5h-3.5"/><path d="M16 10a6 6 0 0 1-10.2 4.2L4 12.5"/><path d="M4 16v-3.5h3.5"/>`
  ),
  download: svg(`<path d="M10 3v10.5"/><path d="M5.5 9.5 10 14l4.5-4.5"/><path d="M4 17h12"/>`),
  chats: svg(
    `<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v6A2.5 2.5 0 0 1 14.5 14H8l-3.5 3v-3H5.5A2.5 2.5 0 0 1 3 11.5Z"/>`
  ),
  pencil: svg(
    `<path d="M12.6 3.4a1.9 1.9 0 0 1 2.7 2.7L6 15.4l-3.5.9.9-3.5Z"/><line x1="11.2" y1="4.8" x2="14.2" y2="7.8"/>`
  ),
  bookmark: svg(
    `<path d="M5.5 3h9a1 1 0 0 1 1 1v13l-5.5-3.5L4.5 17V4a1 1 0 0 1 1-1Z"/>`
  ),
  key: svg(
    `<circle cx="6.5" cy="13.5" r="3"/><path d="M8.7 11.3 15.5 4.5"/><path d="M12.5 7.5l2 2"/><path d="M14.7 5.3l2 2"/>`
  ),
  gear: svg(
    `<circle cx="10" cy="10" r="2.6"/><path d="M10 3.5v2M10 14.5v2M16.5 10h-2M5.5 10h-2M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4M14.8 14.8l-1.4-1.4M6.6 6.6 5.2 5.2"/>`
  ),
  lightbulb: svg(
    `<path d="M7 15.5h6M8 18h4"/><path d="M10 2.5a5 5 0 0 0-3 9c.7.55 1 1.3 1 2h4c0-.7.3-1.45 1-2a5 5 0 0 0-3-9Z"/>`
  ),
  lock: svg(
    `<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>`
  ),
  logout: svg(
    `<path d="M8.5 17H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 3h3.5"/><path d="M13 6.5 16.5 10 13 13.5"/><line x1="16.5" y1="10" x2="8" y2="10"/>`
  ),
  sun: svg(
    `<circle cx="10" cy="10" r="3.2"/><path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9"/>`
  ),
  moon: svg(
    `<path d="M16 12.3A6.8 6.8 0 1 1 7.7 4a5.4 5.4 0 0 0 8.3 8.3Z"/>`
  ),
  monitor: svg(
    `<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><line x1="7" y1="17" x2="13" y2="17"/><line x1="10" y1="13.5" x2="10" y2="17"/>`
  ),
  textRecognize: svg(
    `<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><line x1="5.5" y1="8" x2="14.5" y2="8"/><line x1="5.5" y1="11" x2="12" y2="11"/><line x1="5.5" y1="14" x2="10" y2="14"/>`
  ),
  fileDoc: svg(
    `<path d="M6 2.5h6l3 3v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13.5a1 1 0 0 1 1-1Z"/><path d="M12 2.5V6h3"/>`
  ),
  camera: svg(
    `<rect x="2.5" y="6" width="15" height="10.5" rx="2"/><circle cx="10" cy="11.2" r="3"/><path d="M7 6l1.2-2h3.6L13 6"/>`
  ),
  grid: svg(
    `<rect x="2.5" y="2.5" width="6" height="6" rx="1"/><rect x="11.5" y="2.5" width="6" height="6" rx="1"/><rect x="2.5" y="11.5" width="6" height="6" rx="1"/><rect x="11.5" y="11.5" width="6" height="6" rx="1"/>`
  ),
  swap: svg(
    `<path d="M4 7h11"/><path d="M11.5 3.5 15 7l-3.5 3.5"/><path d="M16 13H5"/><path d="M8.5 9.5 5 13l3.5 3.5"/>`
  ),
  keyboard: svg(
    `<rect x="2.5" y="5" width="15" height="10" rx="1.8"/><line x1="5" y1="8" x2="5.01" y2="8"/><line x1="8" y1="8" x2="8.01" y2="8"/><line x1="11" y1="8" x2="11.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="5" y1="11.2" x2="15" y2="11.2"/>`
  ),
  chevronLeft: svg(`<path d="M12.5 4.5 6.5 10l6 5.5"/>`),
  chevronRight: svg(`<path d="M7.5 4.5 13.5 10l-6 5.5"/>`),
  sparkle: svg(`<path d="M10 2.5 11.8 7.2 16.5 9 11.8 10.8 10 15.5 8.2 10.8 3.5 9 8.2 7.2z"/>`),
  globe: svg(
    `<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15"/><path d="M10 2.5c2.2 2.4 3.3 5 3.3 7.5S12.2 15.1 10 17.5C7.8 15.1 6.7 12.5 6.7 10S7.8 4.9 10 2.5z"/>`
  ),
  share: svg(`<path d="M15.5 7.5 18 10l-2.5 2.5"/><path d="M2 15.5a6.5 6.5 0 0 1 12-4.5"/><line x1="18" y1="10" x2="12" y2="10"/>`),
  chart: svg(`<line x1="3" y1="16.5" x2="17" y2="16.5"/><rect x="4.5" y="10" width="3" height="6.5"/><rect x="8.5" y="6" width="3" height="10.5"/><rect x="12.5" y="3" width="3" height="13.5"/>`),
  fileSearch: svg(`<path d="M11 2.5H6a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-7.5L11 2.5Z"/><path d="M10.5 2.5V7h4.5"/><circle cx="11.5" cy="13.5" r="2.5"/><line x1="13.2" y1="15.2" x2="15.5" y2="17.5"/>`),
  more: svg(`<circle cx="5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/>`),
  brush: svg(`<path d="M14.5 2.5 17.5 5.5 8.5 14.5 5.5 11.5z"/><path d="M5.5 11.5 2.5 14.5a2 2 0 0 0 3 3l3-3z"/>`),
  star: svg(`<path d="M10 2.5l2.2 4.5 5 .7-3.6 3.5.85 5L10 13.7l-4.45 2.5.85-5L2.8 7.7l5-.7z"/>`),
  starFilled: svg(`<path d="M10 2.5l2.2 4.5 5 .7-3.6 3.5.85 5L10 13.7l-4.45 2.5.85-5L2.8 7.7l5-.7z" fill="currentColor"/>`),
  archive: svg(`<rect x="2.5" y="3.5" width="15" height="3.5" rx="1"/><path d="M4 7v8.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7"/><line x1="7.5" y1="11" x2="12.5" y2="11"/>`),
  link: svg(`<path d="M8 11.5a4.5 4.5 0 0 0 6.4 0l2-2a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M12 8.5a4.5 4.5 0 0 0-6.4 0l-2 2a4.5 4.5 0 0 0 6.4 6.4l1-1"/>`),
  people: svg(`<circle cx="7" cy="7" r="3"/><path d="M1 17a6 6 0 0 1 12 0"/><circle cx="15" cy="7" r="2.5"/><path d="M13 17a4 4 0 0 1 6 0"/>`),
  reply: svg(
    `<path d="M7.5 12.5 3.5 8.5 7.5 4.5"/><path d="M3.5 8.5h8A4.5 4.5 0 0 1 16 13v2.5"/>`
  ),
  trash: svg(
    `<path d="M4 6.5h12"/><path d="M8 6.5V4.5h4v2"/><path d="M6.5 6.5l.7 9.5h5.6l.7-9.5"/><path d="M9 9v5"/><path d="M11 9v5"/>`
  ),
  waveform: svg(
    `<path d="M3.5 8v4M6.5 5v10M9.5 7v6M12.5 4v12M16.5 6.5v7"/>`
  ),
  phone: svg(
    `<path d="M6.2 3.5h2.2l1.1 3.2-1.4 1.4a11 11 0 0 0 4.8 4.8l1.4-1.4 3.2 1.1v2.2a1.6 1.6 0 0 1-1.7 1.6A13.5 13.5 0 0 1 3.5 5.2 1.6 1.6 0 0 1 5.1 3.5Z"/>`
  ),
};

export function iconEl(name: keyof typeof icons, extraClass = ""): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `icon${extraClass ? " " + extraClass : ""}`;
  span.innerHTML = icons[name];
  return span;
}
