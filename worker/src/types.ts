export interface Env {
  DB: D1Database;
  MISTRAL_API_KEY: string;
  /** Optional: comma-separated list of allowed frontend origins for CORS + cookies.
   *  If unset, the Worker reflects whatever Origin sent the request (fine for personal use). */
  ALLOWED_ORIGINS?: string;
  FRONTEND_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  password_salt: string;
  oauth_provider: string | null;
  oauth_id: string | null;
  theme: string;
  model: string;
  instructions: string;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  has_password: boolean;
  theme: string;
  model: string;
  instructions: string;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  mistral_conversation_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "agent" | "error";
  content: string;
  attachments: string | null;
  created_at: string;
}

export interface AttachmentIn {
  name: string;
  mime: string;
  size: number;
  dataUrl: string; // data:<mime>;base64,....
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    has_password: !!u.password_hash,
    theme: u.theme,
    model: u.model,
    instructions: u.instructions,
  };
}
