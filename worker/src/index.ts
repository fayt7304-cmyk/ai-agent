import type { Env, ConversationRow, MessageRow, AttachmentIn } from "./types";
import { toPublicUser } from "./types";
import { withCors, json } from "./cors";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getUserFromRequest,
  readSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "./auth";
import { callMistral } from "./mistral";

// ---- Customize your agent defaults here ----------------------------
const DEFAULT_MODEL = "mistral-medium-latest";
const DEFAULT_INSTRUCTIONS = "You are a helpful, friendly assistant. Answer clearly and concisely.";
export const ALLOWED_MODELS = [
  "mistral-large-latest",
  "mistral-medium-latest",
  "mistral-small-latest",
  "magistral-medium-latest",
  "codestral-latest",
];
// A reasonable cap so nobody accidentally ships a huge base64 blob to Mistral.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per file
// ----------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function err(message: string, status = 400) {
  return json({ error: message }, { status });
}

async function handleSignup(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = body?.username?.trim();
  const password = body?.password;

  if (!username || username.length < 3 || username.length > 32) {
    return err("Username must be 3-32 characters.");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return err("Username can only contain letters, numbers, underscores, dots and dashes.");
  }
  if (!password || password.length < 8) {
    return err("Password must be at least 8 characters.");
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return err("That username is already taken.", 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, password_salt, theme, model, instructions, created_at)
     VALUES (?, ?, ?, ?, 'system', ?, ?, ?)`
  )
    .bind(id, username, hash, salt, DEFAULT_MODEL, DEFAULT_INSTRUCTIONS, nowIso())
    .run();

  const { token, maxAge } = await createSession(env, id);
  const resp = json({
    user: { id, username, theme: "system", model: DEFAULT_MODEL, instructions: DEFAULT_INSTRUCTIONS },
  });
  resp.headers.set("Set-Cookie", sessionCookieHeader(token, maxAge));
  return resp;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password) return err("Username and password are required.");

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<any>();
  if (!user) return err("Invalid username or password.", 401);

  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return err("Invalid username or password.", 401);

  const { token, maxAge } = await createSession(env, user.id);
  const resp = json({ user: toPublicUser(user) });
  resp.headers.set("Set-Cookie", sessionCookieHeader(token, maxAge));
  return resp;
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = readSessionToken(request);
  if (token) await destroySession(env, token);
  const resp = json({ ok: true });
  resp.headers.set("Set-Cookie", clearSessionCookieHeader());
  return resp;
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  return json({ user: toPublicUser(user) });
}

async function handleUpdateSettings(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const body = (await request.json().catch(() => null)) as
    | { theme?: string; model?: string; instructions?: string; password?: string }
    | null;
  if (!body) return err("Invalid body.");

  const theme = body.theme && ["light", "dark", "system"].includes(body.theme) ? body.theme : user.theme;
  const model = body.model && ALLOWED_MODELS.includes(body.model) ? body.model : user.model;
  const instructions =
    typeof body.instructions === "string" && body.instructions.trim().length > 0
      ? body.instructions.slice(0, 4000)
      : user.instructions;

  await env.DB.prepare("UPDATE users SET theme = ?, model = ?, instructions = ? WHERE id = ?")
    .bind(theme, model, instructions, user.id)
    .run();

  if (body.password) {
    if (body.password.length < 8) return err("Password must be at least 8 characters.");
    const { hash, salt } = await hashPassword(body.password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
      .bind(hash, salt, user.id)
      .run();
  }

  return json({ user: { id: user.id, username: user.username, theme, model, instructions } });
}

async function handleListConversations(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const { results } = await env.DB.prepare(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC"
  )
    .bind(user.id)
    .all();

  return json({ conversations: results });
}

async function handleCreateConversation(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const id = crypto.randomUUID();
  const ts = nowIso();
  await env.DB.prepare(
    "INSERT INTO conversations (id, user_id, mistral_conversation_id, title, created_at, updated_at) VALUES (?, ?, NULL, 'New chat', ?, ?)"
  )
    .bind(id, user.id, ts, ts)
    .run();

  return json({ conversation: { id, title: "New chat", created_at: ts, updated_at: ts } });
}

async function handleRenameConversation(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first<ConversationRow>();
  if (!convo) return err("Conversation not found.", 404);

  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const title = body?.title?.trim().slice(0, 120);
  if (!title) return err("Title is required.");

  await env.DB.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .bind(title, nowIso(), id)
    .run();

  return json({ ok: true });
}

async function handleDeleteConversation(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!convo) return err("Conversation not found.", 404);

  await env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run();

  return json({ ok: true });
}

async function handleGetMessages(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!convo) return err("Conversation not found.", 404);

  const { results } = await env.DB.prepare(
    "SELECT id, role, content, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  )
    .bind(id)
    .all<MessageRow>();

  const messages = (results || []).map((m) => ({
    ...m,
    attachments: m.attachments ? JSON.parse(m.attachments) : [],
  }));

  return json({ messages });
}

interface ChatRequestBody {
  conversation_id?: string;
  message: string;
  attachments?: AttachmentIn[];
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  if (!env.MISTRAL_API_KEY) {
    return err("MISTRAL_API_KEY is not configured on this Worker.", 500);
  }

  const body = (await request.json().catch(() => null)) as ChatRequestBody | null;
  const attachments = Array.isArray(body?.attachments) ? body!.attachments! : [];
  if (!body || (!body.message?.trim() && attachments.length === 0)) {
    return err("Missing 'message'.");
  }

  for (const att of attachments) {
    // Rough size check on the base64 payload (base64 is ~4/3 the size of raw bytes).
    const approxBytes = Math.floor((att.dataUrl.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      return err(`"${att.name}" is too large. Max file size is ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB.`);
    }
  }

  // Resolve or create the conversation.
  let convo: ConversationRow | null = null;
  if (body.conversation_id) {
    convo = await env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .bind(body.conversation_id, user.id)
      .first<ConversationRow>();
    if (!convo) return err("Conversation not found.", 404);
  } else {
    const id = crypto.randomUUID();
    const ts = nowIso();
    await env.DB.prepare(
      "INSERT INTO conversations (id, user_id, mistral_conversation_id, title, created_at, updated_at) VALUES (?, ?, NULL, 'New chat', ?, ?)"
    )
      .bind(id, user.id, ts, ts)
      .run();
    convo = { id, user_id: user.id, mistral_conversation_id: null, title: "New chat", created_at: ts, updated_at: ts };
  }

  // Save the user's message first so it's never lost even if Mistral errors out.
  const userMsgId = crypto.randomUUID();
  const attMeta = attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size }));
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, 'user', ?, ?, ?)"
  )
    .bind(userMsgId, convo.id, body.message || "", attMeta.length ? JSON.stringify(attMeta) : null, nowIso())
    .run();

  try {
    const result = await callMistral({
      apiKey: env.MISTRAL_API_KEY,
      model: user.model,
      instructions: user.instructions,
      mistralConversationId: convo.mistral_conversation_id,
      message: body.message || "",
      attachments,
    });

    const agentMsgId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, 'agent', ?, NULL, ?)"
    )
      .bind(agentMsgId, convo.id, result.reply || "(empty response)", nowIso())
      .run();

    // Persist the Mistral conversation id + set the title on the first exchange.
    const isFirstExchange = !convo.mistral_conversation_id;
    const newTitle =
      isFirstExchange && convo.title === "New chat" && body.message
        ? body.message.trim().slice(0, 60)
        : convo.title;
    await env.DB.prepare(
      "UPDATE conversations SET mistral_conversation_id = ?, title = ?, updated_at = ? WHERE id = ?"
    )
      .bind(result.mistralConversationId, newTitle, nowIso(), convo.id)
      .run();

    return json({
      conversation_id: convo.id,
      title: newTitle,
      reply: result.reply,
    });
  } catch (e: any) {
    const errorMsgId = crypto.randomUUID();
    const message = e?.message || "Something went wrong talking to the model.";
    await env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, 'error', ?, NULL, ?)"
    )
      .bind(errorMsgId, convo.id, message, nowIso())
      .run();
    return json({ conversation_id: convo.id, error: message }, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    let resp: Response;

    try {
      if (path === "/api/auth/signup" && request.method === "POST") {
        resp = await handleSignup(request, env);
      } else if (path === "/api/auth/login" && request.method === "POST") {
        resp = await handleLogin(request, env);
      } else if (path === "/api/auth/logout" && request.method === "POST") {
        resp = await handleLogout(request, env);
      } else if (path === "/api/auth/me" && request.method === "GET") {
        resp = await handleMe(request, env);
      } else if (path === "/api/settings" && request.method === "PATCH") {
        resp = await handleUpdateSettings(request, env);
      } else if (path === "/api/conversations" && request.method === "GET") {
        resp = await handleListConversations(request, env);
      } else if (path === "/api/conversations" && request.method === "POST") {
        resp = await handleCreateConversation(request, env);
      } else if (path.match(/^\/api\/conversations\/[^/]+$/) && request.method === "PATCH") {
        resp = await handleRenameConversation(request, env, path.split("/").pop()!);
      } else if (path.match(/^\/api\/conversations\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleDeleteConversation(request, env, path.split("/").pop()!);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/messages$/) && request.method === "GET") {
        resp = await handleGetMessages(request, env, path.split("/")[3]);
      } else if (path === "/api/chat" && request.method === "POST") {
        resp = await handleChat(request, env);
      } else {
        resp = json({ error: "Not found" }, { status: 404 });
      }
    } catch (e: any) {
      resp = json({ error: e?.message || "Unknown server error" }, { status: 500 });
    }

    return withCors(resp, request, env);
  },
};
