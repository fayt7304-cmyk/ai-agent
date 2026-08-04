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
export const API_BASE = "https://api.afmarbre.com";

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
}

export interface Conversation {
  id: string;
  title: string;
  starred: boolean;
  archived: boolean;
  visibility?: "private" | "shared";
  created_at: string;
  updated_at: string;
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
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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
    throw new ApiError(data?.error || `Request failed (${resp.status})`, resp.status);
  }
  return data as T;
}

export const api = {
  signup: (username: string, email: string, password: string) =>
    request<{ user: User }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),

  login: (username: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  // Silently creates (or resumes) an anonymous account — no credentials needed.
  // Used so people land straight in the app instead of a login form.
  guestLogin: () => request<{ user: User }>("/api/auth/guest", { method: "POST", body: "{}" }),

  // Upgrades the current guest account into a real one in place, keeping the
  // same id (and therefore all of its conversation history).
  claimAccount: (username: string, email: string, password: string) =>
    request<{ user: User }>("/api/auth/claim", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),

  googleLoginUrl: (mode?: "login" | "link") => 
    `${API_BASE}/api/auth/google${mode ? "?mode=" + mode : ""}`,

  googleLinkUrl: () => `${API_BASE}/api/auth/google?mode=link`,

  unlinkGoogle: () => request<{ user: User }>("/api/auth/google/link", { method: "DELETE" }),

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<{ user: User }>("/api/auth/me", { method: "GET" }),

  updateSettings: (
    patch: Partial<Pick<User, "theme" | "username" | "display_name" | "avatar">> & { password?: string }
  ) => request<{ user: User }>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

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

  setConversationVisibility: (id: string, visibility: "private" | "shared") =>
    request<{ ok: true; visibility: "private" | "shared" }>(`/api/conversations/${id}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    }),

  getConversationFiles: (id: string) =>
    request<{ files: ConversationFile[] }>(`/api/conversations/${id}/files`, { method: "GET" }),

  getConversationUsage: (id: string) =>
    request<ConversationUsage>(`/api/conversations/${id}/usage`, { method: "GET" }),

  getMessages: (id: string) =>
    request<{ messages: Message[]; conversation?: { id: string; title: string; owner: boolean } }>(
      `/api/conversations/${id}/messages`,
      { method: "GET" }
    ),

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