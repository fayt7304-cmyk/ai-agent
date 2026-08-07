export interface Env {
  DB: D1Database;
  MISTRAL_API_KEY: string;
  /** Your Mistral Agent's ID (from https://console.mistral.ai/build/agents), e.g. "ag:...".
   *  All chats use this agent — its model, instructions, and tools are configured on Mistral's side. */
  MISTRAL_AGENT_ID: string;
  /** Optional: comma-separated list of allowed frontend origins for CORS + cookies.
   *  If unset, the Worker reflects whatever Origin sent the request (fine for personal use). */
  ALLOWED_ORIGINS?: string;
  FRONTEND_URL: string;
  /** Optional: shared registrable domain for the session cookie, e.g. ".yourdomain.com".
   *  Set this once the Worker and frontend live on subdomains of the same domain — it
   *  lets the login cookie be sent reliably on mobile browsers. Leave unset to keep the
   *  old cross-site cookie behavior (works less reliably on phones). */
  COOKIE_DOMAIN?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  /** Optional: where lead notification emails get sent (your team's inbox).
   *  Falls back to RESEND_FROM's domain admin if unset — but set this explicitly. */
  LEAD_NOTIFY_TO?: string;
  /** Optional: max chat messages a single user can send in a rolling 24h window.
   *  Unset = unlimited. */
  MAX_MESSAGES_PER_DAY?: string;
  /** Optional: ElevenLabs key for /api/tts (best quality). Preferred when set.
   *  Set with: npx wrangler secret put ELEVENLABS_API_KEY
   *  Never put this in code or in wrangler.toml [vars]. */
  ELEVENLABS_API_KEY?: string;
  /** Optional override for the ElevenLabs model id (default tries multilingual, turbo, flash). */
  ELEVENLABS_MODEL?: string;
  /** Optional: Workers AI REST path when the AI binding is unavailable.
   *    npx wrangler secret put CLOUDFLARE_AI_TOKEN
   *    npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
   *  (no trailing spaces/newlines on ACCOUNT_ID) */
  CLOUDFLARE_AI_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Optional: override Cloudflare AI TTS model.
   *  Default: elevenlabs/eleven-multilingual-v2
   *  https://developers.cloudflare.com/ai/models/elevenlabs/eleven-multilingual-v2/ */
  TTS_MODEL?: string;
  /**
   * AI binding (`[ai] binding = "AI"` in wrangler.toml).
   * Primary: elevenlabs/eleven-multilingual-v2; then MeloTTS / Aura fallbacks.
   */
  AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
  /** v10.2 Durable Object namespace for presence */
  PRESENCE?: DurableObjectNamespace;

  /**
   * Cloudflare Images binding (`[images] binding = "IMAGES"`).
   * Background removal via transform({ segment: "foreground" }).
   */
  IMAGES?: any;
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
  is_guest: number;
  display_name: string | null;
  avatar: string | null;
  /** "Generate memory from chats" switch; missing/NULL is treated as on. */
  memory_enabled?: number | null;
  /** ISO timestamp when the user requested account deletion; null = active. */
  deletion_requested_at?: string | null;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  has_password: boolean;
  google_linked: boolean;
  theme: string;
  is_guest: boolean;
  display_name: string | null;
  avatar: string | null;
  memory_enabled: boolean;
  /** When set, account is in the 7-day soft-delete grace period. */
  deletion_requested_at: string | null;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  mistral_conversation_id: string | null;
  title: string;
  starred: number;
  archived: number;
  visibility: string;
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

export interface LeadRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  has_photo: number;
  created_at: string;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    has_password: !!u.password_hash,
    google_linked: u.oauth_provider === "google",
    theme: u.theme,
    is_guest: !!u.is_guest,
    display_name: u.display_name ?? null,
    avatar: u.avatar ?? null,
    memory_enabled: u.memory_enabled === undefined || u.memory_enabled === null ? true : Number(u.memory_enabled) === 1,
    deletion_requested_at: u.deletion_requested_at ?? null,
  };
}