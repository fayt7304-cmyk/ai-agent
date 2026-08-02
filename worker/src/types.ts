export interface Env {
  DB: D1Database;
  MISTRAL_API_KEY: string;
  /** Optional: comma-separated list of allowed frontend origins for CORS + cookies.
   *  If unset, the Worker reflects whatever Origin sent the request (fine for personal use). */
  ALLOWED_ORIGINS?: string;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  theme: string;
  model: string;
  instructions: string;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
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
    theme: u.theme,
    model: u.model,
    instructions: u.instructions,
  };
}
