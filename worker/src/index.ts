import type { Env, ConversationRow, MessageRow, AttachmentIn } from "./types";
import { toPublicUser } from "./types";
import { withCors, json } from "./cors";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyAllSessionsForUser,
  getUserFromRequest,
  getUserFromToken,
  readSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  createPasswordResetToken,
  consumePasswordResetToken,
  oauthStateCookieHeader,
  clearOauthStateCookieHeader,
  readOauthState,
  randomToken,
} from "./auth";
import { buildGoogleAuthUrl, exchangeCodeForAccessToken, fetchGoogleUserInfo } from "./oauth-google";
import { sendPasswordResetEmail, sendLeadNotificationEmail } from "./email";
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
  const body = (await request.json().catch(() => null)) as
    | { username?: string; email?: string; password?: string }
    | null;
  const username = body?.username?.trim();
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!username || username.length < 3 || username.length > 32) {
    return err("Username must be 3-32 characters.");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return err("Username can only contain letters, numbers, underscores, dots and dashes.");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err("A valid email is required.");
  }
  if (!password || password.length < 8) {
    return err("Password must be at least 8 characters.");
  }

  const existingUsername = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existingUsername) return err("That username is already taken.", 409);
  const existingEmail = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existingEmail) return err("That email is already registered.", 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, password_salt, theme, model, instructions, created_at)
     VALUES (?, ?, ?, ?, ?, 'system', ?, ?, ?)`
  )
    .bind(id, username, email, hash, salt, DEFAULT_MODEL, DEFAULT_INSTRUCTIONS, nowIso())
    .run();

  const { token, maxAge } = await createSession(env, id);
  const resp = json({
    user: {
      id,
      username,
      email,
      has_password: true,
      google_linked: false,
      theme: "system",
      model: DEFAULT_MODEL,
      instructions: DEFAULT_INSTRUCTIONS,
      is_guest: false,
      display_name: null,
      avatar: null,
    },
    // Returned so the frontend can authenticate with a Bearer token when the
    // browser refuses to keep the cross-subdomain session cookie.
    session_token: token,
  });
  resp.headers.set("Set-Cookie", sessionCookieHeader(token, maxAge, env.COOKIE_DOMAIN));
  return resp;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password) return err("Username and password are required.");

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<any>();
  if (!user) return err("Invalid username or password.", 401);

  if (!user.password_hash) {
    return err("This account uses Google sign-in. Please continue with Google instead.", 401);
  }

  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return err("Invalid username or password.", 401);

  const { token, maxAge } = await createSession(env, user.id);
  const resp = json({ user: toPublicUser(user), session_token: token });
  resp.headers.set("Set-Cookie", sessionCookieHeader(token, maxAge, env.COOKIE_DOMAIN));
  return resp;
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = readSessionToken(request);
  if (token) await destroySession(env, token);
  const resp = json({ ok: true });
  resp.headers.set("Set-Cookie", clearSessionCookieHeader(env.COOKIE_DOMAIN));
  return resp;
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  return json({ user: toPublicUser(user) });
}

// A small cap on the base64 avatar payload — the frontend resizes/compresses images
// before upload, so a legitimate avatar should be well under this. Guards against
// someone bypassing the client and shipping a huge blob into a D1 row.
const MAX_AVATAR_BASE64_CHARS = 400_000; // ~300KB of image data

async function handleUpdateSettings(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const body = (await request.json().catch(() => null)) as {
    theme?: string;
    password?: string;
    username?: string;
    display_name?: string | null;
    avatar?: string | null;
  } | null;
  if (!body) return err("Invalid body.");

  const theme = body.theme && ["light", "dark", "system"].includes(body.theme) ? body.theme : user.theme;
  await env.DB.prepare("UPDATE users SET theme = ? WHERE id = ?")
    .bind(theme, user.id)
    .run();

  if (body.password) {
    if (body.password.length < 8) return err("Password must be at least 8 characters.");
    const { hash, salt } = await hashPassword(body.password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
      .bind(hash, salt, user.id)
      .run();
  }

  // Username change — same rules as signup, minus the "taken by someone else" check
  // being a no-op when it's their own current name.
  let username = user.username;
  if (typeof body.username === "string" && body.username.trim() && body.username.trim() !== user.username) {
    const newUsername = body.username.trim();
    if (newUsername.length < 3 || newUsername.length > 32) {
      return err("Username must be 3-32 characters.");
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(newUsername)) {
      return err("Username can only contain letters, numbers, underscores, dots and dashes.");
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id != ?")
      .bind(newUsername, user.id)
      .first();
    if (existing) return err("That username is already taken.", 409);
    await env.DB.prepare("UPDATE users SET username = ? WHERE id = ?").bind(newUsername, user.id).run();
    username = newUsername;
  }

  // Display name — a friendlier "shown as" name, separate from the login username.
  // An empty string clears it back to "no display name set" (falls back to username in the UI).
  let displayName = user.display_name;
  if (typeof body.display_name === "string") {
    displayName = body.display_name.trim().slice(0, 60) || null;
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, user.id).run();
  }

  // Profile picture — a data: URL the frontend has already resized/compressed.
  // Passing avatar: null clears it back to the initials-based default avatar.
  let avatar = user.avatar;
  if (body.avatar !== undefined) {
    if (body.avatar === null) {
      avatar = null;
    } else if (typeof body.avatar === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(body.avatar)) {
      if (body.avatar.length > MAX_AVATAR_BASE64_CHARS) {
        return err("That image is too large — please use a smaller photo.");
      }
      avatar = body.avatar;
    } else {
      return err("Invalid avatar image.");
    }
    await env.DB.prepare("UPDATE users SET avatar = ? WHERE id = ?").bind(avatar, user.id).run();
  }

  return json({
    user: {
      id: user.id,
      username,
      email: user.email,
      has_password: !!user.password_hash,
      google_linked: user.oauth_provider === "google",
      theme,
      is_guest: !!user.is_guest,
      display_name: displayName,
      avatar,
    },
  });
}

// ---- Anonymous / guest accounts --------------------------------------
// Creates a real (but unclaimed) account so guests get full functionality —
// conversations, settings, everything — without ever seeing a login form.
// The account can later be "claimed" (handleClaimAccount) into a normal
// username/password account without losing any history, since it's the
// same row/id the whole time.
async function handleGuestLogin(env: Env): Promise<Response> {
  const id = crypto.randomUUID();
  const username = `guest_${randomToken(6)}`;
  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, password_salt, theme, model, instructions, is_guest, created_at)
     VALUES (?, ?, NULL, '', '', 'system', ?, ?, 1, ?)`
  )
    .bind(id, username, DEFAULT_MODEL, DEFAULT_INSTRUCTIONS, nowIso())
    .run();

  const { token, maxAge } = await createSession(env, id);
  const resp = json({
    user: {
      id,
      username,
      email: null,
      has_password: false,
      google_linked: false,
      theme: "system",
      is_guest: true,
      display_name: null,
      avatar: null,
    },
    // Returned so the frontend can authenticate with a Bearer token when the
    // browser refuses to keep the cross-subdomain session cookie.
    session_token: token,
  });
  resp.headers.set("Set-Cookie", sessionCookieHeader(token, maxAge, env.COOKIE_DOMAIN));
  return resp;
}

// Upgrades the currently-logged-in guest into a real account in place —
// same user id, so their conversations and settings carry over exactly.
async function handleClaimAccount(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (!user.is_guest) return err("This account is already claimed.", 400);

  const body = (await request.json().catch(() => null)) as
    | { username?: string; email?: string; password?: string }
    | null;
  const username = body?.username?.trim();
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!username || username.length < 3 || username.length > 32) {
    return err("Username must be 3-32 characters.");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return err("Username can only contain letters, numbers, underscores, dots and dashes.");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err("A valid email is required.");
  }
  if (!password || password.length < 8) {
    return err("Password must be at least 8 characters.");
  }

  const existingUsername = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id != ?")
    .bind(username, user.id)
    .first();
  if (existingUsername) return err("That username is already taken.", 409);
  const existingEmail = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?")
    .bind(email, user.id)
    .first();
  if (existingEmail) return err("That email is already registered.", 409);

  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(
    "UPDATE users SET username = ?, email = ?, password_hash = ?, password_salt = ?, is_guest = 0 WHERE id = ?"
  )
    .bind(username, email, hash, salt, user.id)
    .run();

  return json({
    user: {
      id: user.id,
      username,
      email,
      has_password: true,
      google_linked: user.oauth_provider === "google",
      theme: user.theme,
      is_guest: false,
      display_name: user.display_name ?? null,
      avatar: user.avatar ?? null,
    },
  });
}

async function handleGoogleStart(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "link" ? "link" : "login";

  let linkUserId = "";
  if (mode === "link") {
    // Linking requires an existing session — bail out early with a clear error
    // rather than sending someone to Google only to fail at the callback.
    // A full-page redirect can't carry an Authorization header, so the frontend
    // may pass ?token=<session token> instead of relying on the cookie.
    const user = (await getUserFromRequest(env, request)) || (await getUserFromToken(env, url.searchParams.get("token")));
    if (user) linkUserId = user.id;
    if (!user) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${env.FRONTEND_URL}?link_error=not_authenticated` },
      });
    }
  }

  // The mode travels inside the opaque state value itself, so it round-trips
  // through Google untouched and can't be tampered with independently of the
  // state check that already happens on callback.
  // For link mode the user id rides along inside the state. The callback
  // verifies state against the state cookie before trusting it, and this means
  // linking works even when the session cookie is dropped on the callback hop.
  const state = mode === "link" ? `link:${linkUserId}:${randomToken(16)}` : `${mode}:${randomToken(16)}`;
  const authUrl = buildGoogleAuthUrl(env, state);
  const resp = new Response(null, { status: 302, headers: { Location: authUrl } });
  resp.headers.append("Set-Cookie", oauthStateCookieHeader(state));
  return resp;
}

async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = readOauthState(request);

  if (!code || !state || !savedState || state !== savedState) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }
  const mode = state.startsWith("link:") ? "link" : "login";

  const accessToken = await exchangeCodeForAccessToken(env, code);
  const info = await fetchGoogleUserInfo(accessToken);

  // ---- Linking a Google account to the currently logged-in user ----
  if (mode === "link") {
    const clearState = clearOauthStateCookieHeader();
    const stateUserId = state.split(":")[1] || "";
    const currentUser =
      (await getUserFromRequest(env, request)) ||
      (stateUserId
        ? await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(stateUserId).first<any>()
        : null);
    if (!currentUser) {
      const resp = new Response(null, {
        status: 302,
        headers: { Location: `${env.FRONTEND_URL}?link_error=not_authenticated` },
      });
      resp.headers.append("Set-Cookie", clearState);
      return resp;
    }

    const conflict = await env.DB.prepare(
      "SELECT id FROM users WHERE oauth_provider = 'google' AND oauth_id = ? AND id != ?"
    )
      .bind(info.sub, currentUser.id)
      .first();
    if (conflict) {
      const resp = new Response(null, {
        status: 302,
        headers: { Location: `${env.FRONTEND_URL}?link_error=already_linked` },
      });
      resp.headers.append("Set-Cookie", clearState);
      return resp;
    }

    await env.DB.prepare(
      "UPDATE users SET oauth_provider = 'google', oauth_id = ?, email = COALESCE(email, ?), display_name = COALESCE(display_name, ?), avatar = COALESCE(avatar, ?), is_guest = 0 WHERE id = ?"
    )
      .bind(
        info.sub,
        info.email?.toLowerCase() || null,
        info.name || null,
        info.picture || null,
        currentUser.id
      )
      .run();

    const resp = new Response(null, { status: 302, headers: { Location: `${env.FRONTEND_URL}?linked=google` } });
    resp.headers.append("Set-Cookie", clearState);
    return resp;
  }

  // ---- Normal Google sign-in / sign-up ----
  let user = await env.DB.prepare("SELECT * FROM users WHERE oauth_provider = 'google' AND oauth_id = ?")
    .bind(info.sub)
    .first<any>();

  if (!user && info.email && info.email_verified) {
    user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(info.email.toLowerCase()).first<any>();
    if (user) {
      await env.DB.prepare(
        "UPDATE users SET oauth_provider = 'google', oauth_id = ?, display_name = COALESCE(display_name, ?), avatar = COALESCE(avatar, ?), is_guest = 0 WHERE id = ?"
      )
        .bind(info.sub, info.name || null, info.picture || null, user.id)
        .run();
    }
  }

  if (!user) {
    const id = crypto.randomUUID();
    const base = (info.email?.split("@")[0] || "user").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24) || "user";
    let candidate = base;
    let suffix = 0;
    while (await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(candidate).first()) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, password_salt, oauth_provider, oauth_id, display_name, avatar, is_guest, theme, model, instructions, created_at)
       VALUES (?, ?, ?, '', '', 'google', ?, ?, ?, 0, 'system', ?, ?, ?)`
    )
      .bind(
        id,
        candidate,
        info.email?.toLowerCase() || null,
        info.sub,
        info.name || null,
        info.picture || null,
        DEFAULT_MODEL,
        DEFAULT_INSTRUCTIONS,
        nowIso()
      )
      .run();
    user = { id };
  }

  const { token, maxAge } = await createSession(env, user.id);
  const resp = new Response(null, {
    status: 302,
    // Fragment (not query) so the token is never sent to a server or logged.
    headers: { Location: `${env.FRONTEND_URL}#session=${token}` },
  });
  resp.headers.append("Set-Cookie", sessionCookieHeader(token, maxAge, env.COOKIE_DOMAIN));
  resp.headers.append("Set-Cookie", clearOauthStateCookieHeader());
  return resp;
}

async function handleUnlinkGoogle(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (!user.password_hash) {
    return err("Set a password first so you don't get locked out of your account.", 400);
  }
  await env.DB.prepare("UPDATE users SET oauth_provider = NULL, oauth_id = NULL WHERE id = ?").bind(user.id).run();
  const updated = { ...user, oauth_provider: null, oauth_id: null };
  return json({ user: toPublicUser(updated as any) });
}

async function handleForgotPassword(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (email) {
    const user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<any>();
    if (user?.email) {
      const rawToken = await createPasswordResetToken(env, user.id);
      const resetUrl = `${env.FRONTEND_URL}/?reset_token=${rawToken}`;
      try {
        await sendPasswordResetEmail(env, user.email, resetUrl);
      } catch (e) {
        console.error("Failed to send reset email", e);
      }
    }
  }
  // Always return ok, whether or not the email exists — avoids leaking which emails are registered.
  return json({ ok: true });
}

async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { token?: string; password?: string } | null;
  if (!body?.token || !body?.password) return err("Missing token or password.");
  if (body.password.length < 8) return err("Password must be at least 8 characters.");

  const userId = await consumePasswordResetToken(env, body.token);
  if (!userId) return err("This reset link is invalid or has expired.", 400);

  const { hash, salt } = await hashPassword(body.password);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, userId)
    .run();
  await destroyAllSessionsForUser(env, userId);

  return json({ ok: true });
}

// ---- Sessions management --------------------------------------------
// Returns all active (non-expired) sessions for the current user so the
// settings UI can show them and let the user revoke individual ones.
async function handleListSessions(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const currentToken = readSessionToken(request);
  const { results } = await env.DB.prepare(
    `SELECT token, created_at, expires_at FROM sessions
     WHERE user_id = ? AND expires_at > ?
     ORDER BY created_at DESC`
  )
    .bind(user.id, nowIso())
    .all<{ token: string; created_at: string; expires_at: string }>();

  // Return sessions as a list — use a hashed id so we never expose the raw token.
  // The frontend only needs to identify a session to revoke it, not read the token.
  const sessions = (results || []).map((s) => ({
    id: s.token.slice(0, 8), // short prefix used as a display id for revocation
    token_prefix: s.token.slice(0, 8),
    created_at: s.created_at,
    expires_at: s.expires_at,
    is_current: s.token === currentToken,
    device: "Browser session",
  }));

  return json(sessions);
}

// Revokes (deletes) a single session by its token prefix. The current
// session cannot be revoked this way — use /api/auth/logout instead.
async function handleRevokeSession(request: Request, env: Env, tokenPrefix: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const currentToken = readSessionToken(request);

  // Find the full token matching the prefix for this user
  const { results } = await env.DB.prepare(
    `SELECT token FROM sessions WHERE user_id = ? AND token LIKE ? AND expires_at > ?`
  )
    .bind(user.id, `${tokenPrefix}%`, nowIso())
    .all<{ token: string }>();

  if (!results || results.length === 0) {
    return err("Session not found.", 404);
  }

  const target = results[0].token;
  if (target === currentToken) {
    return err("Use /api/auth/logout to end your current session.", 400);
  }

  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(target).run();
  return json({ ok: true });
}

// ---- Delete account -------------------------------------------------
// Permanently deletes the user's account and all associated data.
// The DB schema uses ON DELETE CASCADE on conversations/messages/leads,
// so deleting the user row cascades automatically.
async function handleDeleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  // Destroy all sessions first (including the current one)
  await destroyAllSessionsForUser(env, user.id);

  // Delete all conversations and messages (cascade handles messages/leads)
  await env.DB.prepare("DELETE FROM conversations WHERE user_id = ?").bind(user.id).run();

  // Delete any leads associated with this user
  await env.DB.prepare("DELETE FROM leads WHERE user_id = ?").bind(user.id).run();

  // Delete password reset tokens
  await env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(user.id).run();

  // Finally delete the user row itself
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

  const resp = json({ ok: true });
  resp.headers.set("Set-Cookie", clearSessionCookieHeader(env.COOKIE_DOMAIN));
  return resp;
}

// ---- Memory generation ----------------------------------------------
// Generates a memory profile from user's conversation history and returns it as a downloadable file.
async function handleGenerateMemory(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  if (!env.MISTRAL_API_KEY) {
    return err("Memory generation is not configured on this deployment.", 500);
  }

  try {
    // Pull the last 100 user messages across all conversations
    const { results } = await env.DB.prepare(
      `SELECT m.content FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
       ORDER BY m.created_at DESC LIMIT 100`
    )
      .bind(user.id)
      .all<{ content: string }>();

    if (!results || results.length === 0) {
      return err("No conversation history found to generate memory from.", 400);
    }

    const combined = results.map((r) => r.content).join("\n\n");
    const summaryPrompt = `Summarise the following user messages into a detailed memory profile. Include:
- Key interests and topics discussed
- Preferences and patterns
- Important details mentioned
- Conversation themes

Keep it well-organized and under 500 words.

${combined}`;

    const summaryResult = await callMistral({
      apiKey: env.MISTRAL_API_KEY,
      agentId: env.MISTRAL_AGENT_ID,
      mistralConversationId: null,
      message: summaryPrompt,
      attachments: [],
    });

    const memoryContent = summaryResult.reply || "No memory generated.";
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `memory-profile-${timestamp}.txt`;

    // Return as downloadable file
    const resp = new Response(memoryContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
    return resp;
  } catch (e: any) {
    return err("Memory generation encountered an error: " + (e?.message || "Unknown error."), 500);
  }
}

// ---- Uploads management
async function handleListUploads(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  // Collect all attachments across all conversations for this user
  const { results } = await env.DB.prepare(
    `SELECT m.attachments, m.created_at FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ? AND m.attachments IS NOT NULL
     ORDER BY m.created_at DESC`
  )
    .bind(user.id)
    .all<{ attachments: string; created_at: string }>();

  const files: Array<{ name: string; mime: string; size: number; created_at: string; dataUrl?: string }> = [];
  for (const row of results || []) {
    try {
      const atts = JSON.parse(row.attachments) as Array<{ name: string; mime: string; size: number; dataUrl?: string }>;
      for (const a of atts) {
        // dataUrl is only present for files uploaded after content retention was
        // added; older rows list fine but can't be downloaded.
        files.push({ name: a.name, mime: a.mime, size: a.size, created_at: row.created_at, ...(a.dataUrl ? { dataUrl: a.dataUrl } : {}) });
      }
    } catch {
      // malformed JSON — skip
    }
  }

  return json({ uploads: files, files, count: files.length });
}

// ---- Text-to-speech proxy
/**
 * POST /api/tts  { text, voiceId?, language?, speed? } -> audio/mpeg
 *
 * The synthesis key lives only on the Worker (a wrangler secret), so the browser
 * never sees it. Two backends are supported:
 *   1. Cloudflare Workers AI (preferred when CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID are set)
 *   2. ElevenLabs directly (ELEVENLABS_API_KEY)
 * When neither is configured this returns 501 and the frontend falls back to the
 * browser's built-in voice.
 */
async function handleTts(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON body.", 400);
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return err("Nothing to read aloud.", 400);
  // Hard cap so one request can't run away with the account's quota.
  const input = text.slice(0, 4000);

  const voiceId =
    typeof body?.voiceId === "string" && /^[A-Za-z0-9]{8,40}$/.test(body.voiceId)
      ? body.voiceId
      : "EXAVITQu4vr4xnSDxMaL"; // Sarah
  const speedRaw = Number(body?.speed);
  const speed = Number.isFinite(speedRaw) ? Math.min(1.2, Math.max(0.7, speedRaw)) : 1.0;
  const language = typeof body?.language === "string" ? body.language : "en-US";

  const audio = (stream: BodyInit) =>
    new Response(stream, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });

  // Secrets pasted through a terminal often pick up a trailing newline or space.
  // An account id with whitespace in it produced a Cloudflare API 400 / error
  // 7000 "no route for that URI", which surfaced in the app as a broken
  // "high-quality voice" instead of a clean fallback.
  const elevenKey = env.ELEVENLABS_API_KEY?.trim();
  const cfToken = env.CLOUDFLARE_AI_TOKEN?.trim();
  const cfAccount = env.CLOUDFLARE_ACCOUNT_ID?.trim();

  // --- Path 1: ElevenLabs directly (most reliable when a key is present)
  if (elevenKey) {
    const resp = await fetch(
      // output_format MUST be a query param, not part of the JSON body.
      // /stream + turbo model + a low latency hint: the non-streaming
      // multilingual_v2 call routinely took 10-20s for a long reply, which is
      // what made "high-quality voice" look broken. Streaming lets playback
      // start as soon as the first bytes land.
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: input,
          model_id: env.ELEVENLABS_MODEL?.trim() || "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            use_speaker_boost: true,
            speed,
          },
        }),
      }
    );
    if (resp.ok) return audio(resp.body!);
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    console.log("TTS: ElevenLabs failed", resp.status, detail);
    // Fall through to Workers AI if it's configured; otherwise report the real reason.
    if (!(cfToken && cfAccount)) {
      return err(`Voice service error (${resp.status}): ${detail}`, 502);
    }
  }

  // --- Path 2: Cloudflare Workers AI
  if (cfToken && cfAccount) {
    // NOTE: there is no ElevenLabs model on Workers AI — the old default
    // ("@cf/elevenlabs/eleven-multilingual-v2") does not exist, which is exactly
    // what made the Cloudflare API answer 400 / code 7000 "no route for that
    // URI". MeloTTS is the supported text-to-speech model.
    const model = env.TTS_MODEL?.trim() || "@cf/myshell-ai/melotts";
    const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/${model}`;

    // MeloTTS takes { prompt, lang }; other models take { text }. Send a payload
    // that satisfies whichever model is configured.
    const lang = (language.split("-")[0] || "en").toLowerCase();
    const payload: Record<string, unknown> = {
      prompt: input,
      text: input,
      lang: ["en", "es", "fr", "zh", "jp", "kr"].includes(lang) ? lang : "en",
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 300);
      console.log("TTS: Workers AI failed", resp.status, url, detail);
      // 400/404 here means this deployment isn't wired up correctly (wrong model
      // id, wrong account id, token without Workers AI permission). Report it as
      // "not configured" so the app quietly falls back to the device voice
      // instead of showing a raw Cloudflare error to the person chatting.
      const misconfigured = resp.status === 400 || resp.status === 403 || resp.status === 404;
      return err(
        misconfigured
          ? "High-quality voice isn't configured on this deployment."
          : `Voice service error (${resp.status}): ${detail}`,
        misconfigured ? 501 : 502
      );
    }

    const contentType = resp.headers.get("Content-Type") || "";
    // Workers AI answers either with raw audio or with JSON carrying base64 audio,
    // depending on the model. Handling only the first case is why this path
    // produced unplayable "audio" before.
    if (contentType.includes("application/json")) {
      const data: any = await resp.json().catch(() => null);
      const b64 = data?.result?.audio || data?.audio || data?.result?.audio_base64;
      if (typeof b64 !== "string" || !b64) {
        console.log("TTS: Workers AI returned no audio", JSON.stringify(data)?.slice(0, 300));
        return err("High-quality voice isn't configured on this deployment.", 501);
      }
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return audio(bytes);
    }
    return audio(resp.body!);
  }

  return err("High-quality voice isn't configured on this deployment.", 501);
}

async function handleListConversations(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const { results } = await env.DB.prepare(
    "SELECT id, title, starred, archived, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY starred DESC, updated_at DESC"
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

  return json({ conversation: { id, title: "New chat", starred: 0, archived: 0, created_at: ts, updated_at: ts } });
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

// Some deployments were created before migrations 0005/0006 existed, so their
// `conversations` table can be missing the starred/archived/visibility columns.
// That made Star, Archive and Share fail with an opaque 500. Rather than depend
// on the operator remembering to run migrations, add the columns on demand the
// first time one of those endpoints is hit (ALTER TABLE errors for an existing
// column are ignored, and the result is cached per isolate).
let conversationColumnsReady = false;
async function ensureConversationColumns(env: Env): Promise<void> {
  if (conversationColumnsReady) return;
  const alters = [
    "ALTER TABLE conversations ADD COLUMN starred INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'",
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // Column already exists — nothing to do.
    }
  }
  conversationColumnsReady = true;
}

async function handleStarConversation(request: Request, env: Env, id: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id, starred FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first<{ id: string; starred: number }>();
  if (!convo) return err("Conversation not found.", 404);

  const body = (await request.json().catch(() => null)) as { starred?: boolean } | null;
  // If body provides an explicit value, use it; otherwise toggle the current state.
  const newStarred = body?.starred !== undefined ? (body.starred ? 1 : 0) : (convo.starred ? 0 : 1);

  await env.DB.prepare("UPDATE conversations SET starred = ?, updated_at = ? WHERE id = ?")
    .bind(newStarred, nowIso(), id)
    .run();

  return json({ ok: true, starred: !!newStarred });
}

async function handleArchiveConversation(request: Request, env: Env, id: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id, archived FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first<{ id: string; archived: number }>();
  if (!convo) return err("Conversation not found.", 404);

  const body = (await request.json().catch(() => null)) as { archived?: boolean } | null;
  // If body provides an explicit value, use it; otherwise toggle the current state.
  const newArchived = body?.archived !== undefined ? (body.archived ? 1 : 0) : (convo.archived ? 0 : 1);

  await env.DB.prepare("UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?")
    .bind(newArchived, nowIso(), id)
    .run();

  return json({ ok: true, archived: !!newArchived });
}

async function handleGetConversationFiles(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!convo) return err("Conversation not found.", 404);

  // Collect all messages in this conversation that have attachments.
  const { results } = await env.DB.prepare(
    "SELECT id, role, attachments, created_at FROM messages WHERE conversation_id = ? AND attachments IS NOT NULL ORDER BY created_at ASC"
  )
    .bind(id)
    .all<{ id: string; role: string; attachments: string; created_at: string }>();

  const files: Array<{ name: string; mime: string; size: number; role: string; message_id: string; created_at: string; dataUrl?: string }> = [];
  for (const row of results || []) {
    try {
      const atts = JSON.parse(row.attachments) as Array<{ name: string; mime: string; size: number; dataUrl?: string }>;
      for (const a of atts) {
        files.push({ name: a.name, mime: a.mime, size: a.size, role: row.role, message_id: row.id, created_at: row.created_at, ...(a.dataUrl ? { dataUrl: a.dataUrl } : {}) });
      }
    } catch {
      // malformed JSON — skip
    }
  }

  return json({ files });
}

async function handleGetConversationUsage(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first<{ id: string; title: string; created_at: string; updated_at: string }>();
  if (!convo) return err("Conversation not found.", 404);

  // Count messages by role
  const { results } = await env.DB.prepare(
    "SELECT role, COUNT(*) AS n, SUM(LENGTH(content)) AS chars FROM messages WHERE conversation_id = ? GROUP BY role"
  )
    .bind(id)
    .all<{ role: string; n: number; chars: number }>();

  let userMessages = 0;
  let agentMessages = 0;
  let totalChars = 0;
  for (const row of results || []) {
    if (row.role === "user") userMessages = row.n;
    else if (row.role === "agent") agentMessages = row.n;
    totalChars += row.chars || 0;
  }

  // Rough token estimate: ~4 chars per token is a common approximation.
  const estimatedTokens = Math.round(totalChars / 4);

  // Calculate time worked: difference between first and last message
  const firstMsg = await env.DB.prepare(
    "SELECT created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1"
  ).bind(id).first<{ created_at: string }>();
  const lastMsg = await env.DB.prepare(
    "SELECT created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(id).first<{ created_at: string }>();

  let durationSeconds = 0;
  if (firstMsg && lastMsg && firstMsg.created_at !== lastMsg.created_at) {
    durationSeconds = Math.round(
      (new Date(lastMsg.created_at).getTime() - new Date(firstMsg.created_at).getTime()) / 1000
    );
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const timeWorked = durationSeconds > 0 ? `${minutes}m ${seconds}s` : "< 1m";

  return json({
    conversation_id: id,
    title: convo.title,
    user_messages: userMessages,
    agent_messages: agentMessages,
    total_messages: userMessages + agentMessages,
    estimated_tokens: estimatedTokens,
    time_worked: timeWorked,
    created_at: convo.created_at,
    updated_at: convo.updated_at,
  });
}

async function handleGetMessages(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id, user_id, title, visibility FROM conversations WHERE id = ?")
    .bind(id)
    .first<{ id: string; user_id: string; title: string; visibility: string }>();

  // Distinguish "doesn't exist" from "exists but you're not allowed to see it" so the
  // frontend can show a clear "ask the owner for access" message on shared links,
  // rather than a generic not-found.
  if (!convo) return err("Conversation not found.", 404);
  const isOwner = convo.user_id === user.id;
  const isShared = convo.visibility === "shared";
  if (!isOwner && !isShared) {
    return err("Access forbidden. Ask the owner to share a link with access.", 403);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, role, content, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  )
    .bind(id)
    .all<MessageRow>();

  const messages = (results || []).map((m) => ({
    ...m,
    attachments: m.attachments ? JSON.parse(m.attachments) : [],
  }));

  return json({ messages, conversation: { id: convo.id, title: convo.title, owner: isOwner } });
}

async function handleSetConversationVisibility(request: Request, env: Env, id: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!convo) return err("Conversation not found.", 404);

  const body = (await request.json().catch(() => null)) as { visibility?: string } | null;
  const visibility = body?.visibility === "shared" ? "shared" : "private";

  await env.DB.prepare("UPDATE conversations SET visibility = ?, updated_at = ? WHERE id = ?")
    .bind(visibility, nowIso(), id)
    .run();

  return json({ ok: true, visibility });
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

  const dailyLimit = env.MAX_MESSAGES_PER_DAY ? parseInt(env.MAX_MESSAGES_PER_DAY, 10) : 0;
  if (dailyLimit > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user' AND m.created_at > ?`
    )
      .bind(user.id, since)
      .first<{ n: number }>();
    if ((row?.n || 0) >= dailyLimit) {
      return err(`Daily message limit reached (${dailyLimit}/day). Please try again tomorrow.`, 429);
    }
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
    convo = { id, user_id: user.id, mistral_conversation_id: null, title: "New chat", starred: 0, archived: 0, visibility: "private", created_at: ts, updated_at: ts };
  }

  // Save the user's message first so it's never lost even if Mistral errors out.
  const userMsgId = crypto.randomUUID();
  // Keep dataUrl alongside the metadata so "Uploaded files" and the per-chat
  // Files list can offer a real download later (agent attachments already do).
  const attMeta = attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size, dataUrl: a.dataUrl }));
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, 'user', ?, ?, ?)"
  )
    .bind(userMsgId, convo.id, body.message || "", attMeta.length ? JSON.stringify(attMeta) : null, nowIso())
    .run();

  try {
    const result = await callMistral({
      apiKey: env.MISTRAL_API_KEY,
      agentId: env.MISTRAL_AGENT_ID,
      mistralConversationId: convo.mistral_conversation_id,
      message: body.message || "",
      attachments,
    });

    const agentMsgId = crypto.randomUUID();
    const agentAttachments = result.attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size, dataUrl: a.dataUrl }));
    await env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, 'agent', ?, ?, ?)"
    )
      .bind(agentMsgId, convo.id, result.reply || "(empty response)", agentAttachments.length ? JSON.stringify(agentAttachments) : null, nowIso())
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
      attachments: agentAttachments,
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

interface LeadRequestBody {
  conversation_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  has_photo?: boolean;
  /** data:<mime>;base64,<data> — the actual (client-compressed) photo, sent as an email attachment. */
  photo_data_url?: string;
}

const MAX_LEAD_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB decoded — client already compresses to well under this

async function handleCreateLead(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const body = (await request.json().catch(() => null)) as LeadRequestBody | null;
  if (!body) return err("Invalid body.");

  const name = body.name?.trim().slice(0, 120) || null;
  const phone = body.phone?.trim().slice(0, 60) || null;
  const email = body.email?.trim().slice(0, 200) || null;
  const message = body.message?.trim().slice(0, 4000) || null;
  if (!name && !phone && !email && !message) {
    return err("Please fill in at least one field.");
  }

  let photoBase64: string | null = null;
  if (body.photo_data_url) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(body.photo_data_url);
    if (!match) return err("Invalid photo.");
    const [, , data] = match;
    const approxBytes = Math.round((data.length * 3) / 4);
    if (approxBytes > MAX_LEAD_PHOTO_BYTES) {
      return err(`Photo is too large. Max size is ${Math.floor(MAX_LEAD_PHOTO_BYTES / (1024 * 1024))}MB.`);
    }
    photoBase64 = data;
  }
  const hasPhoto = !!photoBase64 || !!body.has_photo;

  const id = crypto.randomUUID();
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO leads (id, user_id, conversation_id, name, phone, email, message, has_photo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, body.conversation_id || null, name, phone, email, message, hasPhoto ? 1 : 0, ts)
    .run();

  if (env.LEAD_NOTIFY_TO) {
    try {
      await sendLeadNotificationEmail(env, env.LEAD_NOTIFY_TO, {
        name,
        phone,
        email,
        message,
        hasPhoto,
        fromUsername: user.username,
        photoBase64,
      });
    } catch (e) {
      console.error("Failed to send lead notification", e);
    }
  } else {
    // No recipient configured — the lead is still saved to D1, but nobody gets emailed.
    console.warn("LEAD_NOTIFY_TO is not set; lead saved but no notification email was sent.");
  }

  return json({ ok: true, lead_id: id });
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
      } else if (path === "/api/auth/guest" && request.method === "POST") {
        resp = await handleGuestLogin(env);
      } else if (path === "/api/auth/claim" && request.method === "POST") {
        resp = await handleClaimAccount(request, env);
      } else if (path === "/api/auth/google" && request.method === "GET") {
        resp = await handleGoogleStart(request, env);
      } else if (path === "/api/auth/google/callback" && request.method === "GET") {
        resp = await handleGoogleCallback(request, env);
      } else if (path === "/api/auth/google/link" && request.method === "DELETE") {
        resp = await handleUnlinkGoogle(request, env);
      } else if (path === "/api/auth/forgot-password" && request.method === "POST") {
        resp = await handleForgotPassword(request, env);
      } else if (path === "/api/auth/reset-password" && request.method === "POST") {
        resp = await handleResetPassword(request, env);
      } else if (path === "/api/settings" && request.method === "PATCH") {
        resp = await handleUpdateSettings(request, env);
      } else if (path === "/api/sessions" && request.method === "GET") {
        // List all active sessions for the current user
        resp = await handleListSessions(request, env);
      } else if (path.match(/^\/api\/sessions\/[^/]+$/) && request.method === "DELETE") {
        // Revoke a specific session by its token prefix
        resp = await handleRevokeSession(request, env, path.split("/").pop()!);
      } else if (path === "/api/user/delete" && request.method === "DELETE") {
        // Permanently delete the current user's account and all data
        resp = await handleDeleteAccount(request, env);
      } else if (path === "/api/memory/generate" && request.method === "POST") {
        // Generate a memory summary from the user's conversation history
        resp = await handleGenerateMemory(request, env);
      } else if (path === "/api/tts" && request.method === "POST") {
        // Studio text-to-speech, proxied so the key stays server-side
        resp = await handleTts(request, env);
      } else if (path === "/api/uploads" && request.method === "GET") {
        // List uploads/attachments for the current user
        resp = await handleListUploads(request, env);
      } else if (path === "/api/conversations" && request.method === "GET") {
        resp = await handleListConversations(request, env);
      } else if (path === "/api/conversations" && request.method === "POST") {
        resp = await handleCreateConversation(request, env);
      } else if (path.match(/^\/api\/conversations\/[^/]+$/) && request.method === "PATCH") {
        resp = await handleRenameConversation(request, env, path.split("/").pop()!);
      } else if (path.match(/^\/api\/conversations\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleDeleteConversation(request, env, path.split("/").pop()!);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/star$/) && request.method === "PATCH") {
        resp = await handleStarConversation(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/archive$/) && request.method === "PATCH") {
        resp = await handleArchiveConversation(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/visibility$/) && request.method === "PATCH") {
        resp = await handleSetConversationVisibility(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/files$/) && request.method === "GET") {
        resp = await handleGetConversationFiles(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/usage$/) && request.method === "GET") {
        resp = await handleGetConversationUsage(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/messages$/) && request.method === "GET") {
        resp = await handleGetMessages(request, env, path.split("/")[3]);
      } else if (path === "/api/chat" && request.method === "POST") {
        resp = await handleChat(request, env);
      } else if (path === "/api/leads" && request.method === "POST") {
        resp = await handleCreateLead(request, env);
      } else {
        resp = json({ error: "Not found" }, { status: 404 });
      }
    } catch (e: any) {
      resp = json({ error: e?.message || "Unknown server error" }, { status: 500 });
    }

    return withCors(resp, request, env);
  },
};
