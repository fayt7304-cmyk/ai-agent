// Point this at your deployed Worker (see README). Include the origin only, no trailing slash.
//
// IMPORTANT (mobile login): this now points at api.afmarbre.com instead of the
// *.workers.dev address. That's not cosmetic — the frontend lives on ai.afmarbre.com,
// and mobile browsers (especially iOS Safari) routinely drop the login cookie when it
// comes from a completely unrelated domain like workers.dev. Putting the API on a
// subdomain of the same domain as the frontend makes the cookie same-site, which is
// what actually fixes "not authenticated" after logging in on a phone. See the worker's
// wrangler.toml (GOOGLE_REDIRECT_URI, COOKIE_DOMAIN) — both must point at this same
// custom domain, and the Worker needs that custom domain added in the Cloudflare
// dashboard (Workers & Pages → mistral-agent-chat → Settings → Domains & Routes).
//
// The value can be overridden without editing code, which matters when the
// custom domain isn't attached to the Worker yet (that shows up in the app as
// "the worker doesn't work" — every request fails because nothing answers at
// api.afmarbre.com). Precedence:
//   1. VITE_API_BASE at build time  (echo 'VITE_API_BASE=https://xxx.workers.dev' > .env)
//   2. localStorage "api-base"      (for quick debugging in a live browser)
//   3. the custom domain below
function resolveApiBase(): string {
  const fromEnv = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  let fromStorage: string | null = null;
  try {
    fromStorage = localStorage.getItem("api-base");
  } catch {
    // storage blocked — ignore
  }
  return (fromEnv || fromStorage || "https://api.afmarbre.com").replace(/\/+$/, "");
}

export const API_BASE = resolveApiBase();

export interface User {
  id: string;
  username: string;
  email: string | null;
  has_password: boolean;
  google_linked: boolean;
  theme: "light" | "dark" | "system";
  is_guest: boolean;
  display_name: string | null;
  avatar: string | null;
  /** ISO time when soft-delete was requested; null if active. */
  deletion_requested_at?: string | null;
  memory_enabled?: boolean;
}

/**
 * Conversation sharing modes:
 * - private: only the owner can open it
 * - shared:  anyone signed in with the link can read it
 * - collab:  anyone signed in with the link can read AND reply
 */
export type Visibility = "private" | "shared" | "collab";

export interface Conversation {
  id: string;
  title: string;
  starred: boolean;
  archived: boolean;
  visibility?: Visibility;
  collab_locked?: boolean;
  /** True when you joined via collab invite (not the owner). */
  is_collab_member?: boolean | number;
  created_at: string;
  updated_at: string;
}

export interface MessageSender {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  avatar: string | null;
  is_paul?: boolean;
}

export interface ConversationFile {
  name: string;
  mime: string;
  size: number;
  role: string;
  message_id: string;
  created_at: string;
}

export interface ConversationUsage {
  conversation_id: string;
  title: string;
  user_messages: number;
  agent_messages: number;
  total_messages: number;
  estimated_tokens: number;
  time_worked: string;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  name: string;
  mime: string;
  size: number;
  dataUrl?: string;
}

export interface Message {
  id: string;
  role: "user" | "agent" | "error";
  content: string;
  attachments: Attachment[];
  created_at: string;
  sender?: MessageSender | null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Session token (the fix for "it shows the login page even though I was logged in")
//
// The session used to live only in a cookie set by api.afmarbre.com. Browsers
// that block third-party/cross-site cookies — iOS Safari, Firefox ETP, Chrome
// incognito — dropped it, so /api/auth/me came back 401 and the app fell back
// to the login/guest screen on every visit. The Worker now also returns the
// session token in the response body (and in the URL fragment after Google
// sign-in); we keep a copy here and send it as a Bearer token on every request,
// so the session survives whatever the browser does with cookies.
// ---------------------------------------------------------------------------
const TOKEN_KEY = "session-token";

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let sessionToken: string | null = readStoredToken();

export function setSessionToken(token: string | null) {
  sessionToken = token || null;
  try {
    if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode with storage disabled — the cookie path still applies.
  }
}

export function getSessionToken(): string | null {
  return sessionToken;
}

/** Headers to attach to any hand-rolled fetch against the Worker. */
export function authHeaders(): Record<string, string> {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}

/**
 * Google sign-in comes back as a redirect to the frontend with `#session=<token>`.
 * Pick it up (and scrub it from the URL) before anything calls the API.
 */
export function captureSessionFromUrl() {
  const hash = window.location.hash || "";
  const match = hash.match(/[#&]session=([^&]+)/);
  if (!match) return;
  setSessionToken(decodeURIComponent(match[1]));
  const cleaned = hash.replace(/[#&]session=[^&]*/, "");
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search + (cleaned === "#" ? "" : cleaned)
  );
}

captureSessionFromUrl();

// Anything in the app that fetches the Worker directly (settings, text-to-speech)
// gets the credentials and the Bearer token without having to remember to add
// them at each call site.
const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(API_BASE)) return nativeFetch(input as any, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (sessionToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${sessionToken}`);
  return nativeFetch(input as any, { ...init, credentials: "include", headers });
}) as typeof window.fetch;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers || {}),
    },
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // no body
  }

  if (!resp.ok) {
    // A rejected session is worth forgetting — otherwise a stale token keeps
    // being replayed on every request.
    if (resp.status === 401 && path !== "/api/auth/login") setSessionToken(null);
    throw new ApiError(data?.error || `Request failed (${resp.status})`, resp.status);
  }
  if (data && typeof data.session_token === "string") setSessionToken(data.session_token);
  return data as T;
}

/** One durable fact Paul keeps about the user across conversations. */
export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export const api = {
  signup: (username: string, email: string, password: string) =>
    request<{ user: User; session_token?: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),

  login: (username: string, password: string) =>
    request<{ user: User; session_token?: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  // Silently creates (or resumes) an anonymous account — no credentials needed.
  // Used so people land straight in the app instead of a login form.
  guestLogin: () => request<{ user: User; session_token?: string }>("/api/auth/guest", { method: "POST", body: "{}" }),

  // Upgrades the current guest account into a real one in place, keeping the
  // same id (and therefore all of its conversation history).
  claimAccount: (username: string, email: string, password: string) =>
    request<{ user: User; session_token?: string }>("/api/auth/claim", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),

  googleLoginUrl: (mode?: "login" | "link") => 
    `${API_BASE}/api/auth/google${mode ? "?mode=" + mode : ""}`,

  // Linking happens through a full-page redirect, so no Authorization header can
  // be attached. The session token travels as a query param instead — without it
  // the Worker can't see who is linking (third-party cookies are often dropped)
  // and bounced straight back with link_error=not_authenticated.
  googleLinkUrl: () => {
    const token = getSessionToken();
    return `${API_BASE}/api/auth/google?mode=link${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  },

  unlinkGoogle: () => request<{ user: User; session_token?: string }>("/api/auth/google/link", { method: "DELETE" }),

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),

  logout: async () => {
    try {
      return await request<{ ok: true }>("/api/auth/logout", { method: "POST" });
    } finally {
      // Drop the local copy even if the network call failed, so "log out" always
      // actually logs out on this device.
      setSessionToken(null);
    }
  },

  me: () => request<{ user: User; session_token?: string }>("/api/auth/me", { method: "GET" }),

  updateSettings: (
    patch: Partial<Pick<User, "theme" | "username" | "display_name" | "avatar">> & { password?: string }
  ) => request<{ user: User; session_token?: string }>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  // ---- Paul's cross-chat memory ----
  listMemory: () => request<{ enabled: boolean; memories: MemoryEntry[] }>("/api/memory", { method: "GET" }),

  setMemoryEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>("/api/memory/settings", { method: "PATCH", body: JSON.stringify({ enabled }) }),

  addMemory: (content: string, title?: string) =>
    request<{ memories: MemoryEntry[] }>("/api/memory", { method: "POST", body: JSON.stringify({ content, title }) }),

  deleteMemory: (id: string) => request<{ memories: MemoryEntry[] }>(`/api/memory/${id}`, { method: "DELETE" }),

  /** Direct edit of title/content by the user (no AI). */
  updateMemory: (id: string, title: string, content: string) =>
    request<{ memories: MemoryEntry[] }>(`/api/memory/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title, content }),
    }),

  /** Ask Paul to revise one memory entry from a natural-language instruction. */
  reviseMemory: (id: string, instruction: string) =>
    request<{ memories: MemoryEntry[]; deleted?: boolean }>("/api/memory/revise", {
      method: "POST",
      body: JSON.stringify({ id, instruction }),
    }),

  refreshMemory: () =>
    request<{ added: number; memories: MemoryEntry[] }>("/api/memory/generate", { method: "POST", body: "{}" }),

  listConversations: () => request<{ conversations: Conversation[] }>("/api/conversations", { method: "GET" }),

  createConversation: () =>
    request<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: "{}" }),

  renameConversation: (id: string, title: string) =>
    request<{ ok: true }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),

  deleteConversation: (id: string) => request<{ ok: true }>(`/api/conversations/${id}`, { method: "DELETE" }),

  starConversation: (id: string, starred?: boolean) =>
    request<{ ok: true; starred: boolean }>(`/api/conversations/${id}/star`, {
      method: "PATCH",
      body: starred !== undefined ? JSON.stringify({ starred }) : "{}",
    }),

  archiveConversation: (id: string, archived?: boolean) =>
    request<{ ok: true; archived: boolean }>(`/api/conversations/${id}/archive`, {
      method: "PATCH",
      body: archived !== undefined ? JSON.stringify({ archived }) : "{}",
    }),

  setConversationVisibility: (id: string, visibility: Visibility) =>
    request<{ ok: true; visibility: Visibility; collab_code?: string | null }>(`/api/conversations/${id}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    }),

  getConversationFiles: (id: string) =>
    request<{ files: ConversationFile[] }>(`/api/conversations/${id}/files`, { method: "GET" }),

  getConversationUsage: (id: string) =>
    request<ConversationUsage>(`/api/conversations/${id}/usage`, { method: "GET" }),

    joinCollab: (id: string, code: string) =>
    request<{ ok: true; conversation_id: string; title?: string }>(`/api/conversations/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

getMessages: (id: string) =>
    request<{
      messages: Message[];
      conversation?: {
        id: string;
        title: string;
        owner: boolean;
        visibility?: Visibility;
        can_write?: boolean;
        collab_locked?: boolean;
        is_member?: boolean;
      };
    }>(`/api/conversations/${id}/messages`, { method: "GET" }),

  sendMessage: (payload: { conversation_id?: string; message: string; attachments?: Attachment[] }) =>
    request<{ conversation_id: string; title: string; reply: string; attachments?: Attachment[] }>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  submitLead: (payload: {
    conversation_id?: string;
    name?: string;
    phone?: string;
    email?: string;
    message?: string;
    has_photo?: boolean;
    photo_data_url?: string;
  }) =>
    request<{ ok: true; lead_id: string }>("/api/leads", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};