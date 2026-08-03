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
};

export function iconEl(name: keyof typeof icons, extraClass = ""): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `icon${extraClass ? " " + extraClass : ""}`;
  span.innerHTML = icons[name];
  return span;
}
