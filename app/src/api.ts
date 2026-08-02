// Point this at your deployed Worker (see README). Include the origin only, no trailing slash.
export const API_BASE = "https://mistral-agent-chat.fayt7304.workers.dev";

export interface User {
  id: string;
  username: string;
  email: string | null;
  has_password: boolean;
  theme: "light" | "dark" | "system";
  model: string;
  instructions: string;
}

export interface Conversation {
  id: string;
  title: string;
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

  googleLoginUrl: () => `${API_BASE}/api/auth/google`,

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<{ user: User }>("/api/auth/me", { method: "GET" }),

  updateSettings: (patch: Partial<Pick<User, "theme" | "model" | "instructions">> & { password?: string }) =>
    request<{ user: User }>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  listConversations: () => request<{ conversations: Conversation[] }>("/api/conversations", { method: "GET" }),

  createConversation: () =>
    request<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: "{}" }),

  renameConversation: (id: string, title: string) =>
    request<{ ok: true }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),

  deleteConversation: (id: string) => request<{ ok: true }>(`/api/conversations/${id}`, { method: "DELETE" }),

  getMessages: (id: string) => request<{ messages: Message[] }>(`/api/conversations/${id}/messages`, { method: "GET" }),

  sendMessage: (payload: { conversation_id?: string; message: string; attachments?: Attachment[] }) =>
    request<{ conversation_id: string; title: string; reply: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
