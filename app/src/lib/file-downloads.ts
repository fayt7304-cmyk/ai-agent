/**
 * Shared rendering + download helpers for stored attachments.
 *
 * Used by both the chat "Files" modal and Settings › Privacy › Uploaded files so
 * the two lists look and behave identically.
 */

import { t } from "./i18n";

export interface StoredFile {
  name: string;
  mime: string;
  size: number;
  created_at?: string;
  /** Present for files stored with their contents; older rows may not have it. */
  dataUrl?: string | null;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name: string): string {
  return (name || "file").replace(/[/\\?%*:|"<>]/g, "-");
}

/** Trigger a browser download for one stored file. */
export function downloadFile(file: StoredFile) {
  if (!file.dataUrl) return;
  const a = document.createElement("a");
  a.href = file.dataUrl;
  a.download = safeFileName(file.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download every file that has stored contents. Browsers throttle rapid-fire
 * programmatic downloads, so they're spaced out slightly.
 */
export async function downloadAllFiles(files: StoredFile[]) {
  const downloadable = files.filter((f) => f.dataUrl);
  for (let i = 0; i < downloadable.length; i++) {
    downloadFile(downloadable[i]!);
    if (i < downloadable.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
}

const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

/**
 * Render a list of files with a download button on each row.
 * `metaFor` lets a caller customise the secondary line (the chat modal shows
 * who the file came from, settings shows just size and date).
 */
export function renderFileList(
  container: HTMLElement,
  files: StoredFile[],
  metaFor?: (file: StoredFile) => string
) {
  container.innerHTML = "";
  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "settings-muted";
    empty.textContent = t("files.empty");
    container.appendChild(empty);
    return;
  }

  for (const file of files) {
    const row = document.createElement("div");
    row.className = "file-row";

    const info = document.createElement("div");
    info.className = "file-row-info";

    const name = document.createElement("div");
    name.className = "file-row-name";
    name.textContent = file.name;
    name.title = file.name;

    const meta = document.createElement("div");
    meta.className = "file-row-meta";
    if (metaFor) {
      meta.textContent = metaFor(file);
    } else {
      const parts = [formatBytes(file.size)];
      if (file.created_at) parts.push(new Date(file.created_at).toLocaleDateString());
      meta.textContent = parts.join(" · ");
    }

    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(info);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-download-btn";
    btn.innerHTML = DOWNLOAD_ICON;
    if (file.dataUrl) {
      btn.title = t("files.download");
      btn.setAttribute("aria-label", `${t("files.download")} ${file.name}`);
      btn.addEventListener("click", () => downloadFile(file));
    } else {
      // Files uploaded before contents were retained can be listed but not re-downloaded.
      btn.disabled = true;
      btn.title = t("files.notStored");
      btn.setAttribute("aria-label", t("files.notStored"));
    }
    row.appendChild(btn);

    container.appendChild(row);
  }
}
