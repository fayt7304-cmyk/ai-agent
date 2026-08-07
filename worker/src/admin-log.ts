/**
 * In-isolate ring buffer of server events for the admin download endpoint.
 * Survives for the lifetime of a Worker isolate (not permanent disk storage).
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
}

/** Built-in owner usernames (always full access). */
export const OWNER_USERNAMES = ["fayt7304", "fay7304"];

/** @deprecated use OWNER_USERNAMES / staff roles — kept for compatibility */
export const ADMIN_USERNAMES = OWNER_USERNAMES;

export type StaffRole = "owner" | "moderator" | "catalog";

export const STAFF_ROLE_MISSIONS: Record<StaffRole, string> = {
  owner: "Full control: users, bans, catalog, logs, roles",
  moderator: "Community safety: ban / unban users, view accounts",
  catalog: "Business catalog: product sheets & price bands (RAG)",
};

const MAX = 500;
const buffer: LogEntry[] = [];

export function adminLog(level: LogLevel, source: string, message: string, detail?: unknown) {
  let detailStr: string | undefined;
  if (detail !== undefined && detail !== null) {
    try {
      detailStr = typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 2000);
    } catch {
      detailStr = String(detail);
    }
  }
  buffer.push({
    ts: new Date().toISOString(),
    level,
    source,
    message: String(message).slice(0, 500),
    detail: detailStr,
  });
  while (buffer.length > MAX) buffer.shift();
}

export function getAdminLogs(): LogEntry[] {
  return buffer.slice();
}

export function clearAdminLogs(): number {
  const n = buffer.length;
  buffer.length = 0;
  return n;
}

export function formatAdminLogsText(entries: LogEntry[]): string {
  const lines = entries.map((e) => {
    const d = e.detail ? ` | ${e.detail}` : "";
    return `${e.ts} [${e.level.toUpperCase()}] ${e.source}: ${e.message}${d}`;
  });
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export function isOwnerUsername(username: string | null | undefined): boolean {
  const u = (username || "").trim().toLowerCase();
  return OWNER_USERNAMES.includes(u);
}

/** Legacy helper — true for built-in owners only (not assigned staff). */
export function isAdminUser(username: string | null | undefined): boolean {
  return isOwnerUsername(username);
}
