import type { Env, ConversationRow, MessageRow, AttachmentIn } from "./types";
export { PresenceHub } from "./presence-do";
export { CallRoom } from "./call-do";
import { toPublicUser } from "./types";
import { withCors, json } from "./cors";
import {
  hashPassword,
  verifyPassword,
  createSession,
  GUEST_SESSION_DAYS,
  purgeExpiredGuestData,
  summarizeUserAgent,
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
  signOauthState,
  verifyOauthState,
  randomToken,
} from "./auth";
import { buildGoogleAuthUrl, exchangeCodeForAccessToken, fetchGoogleUserInfo } from "./oauth-google";
import { sendPasswordResetEmail, sendLeadNotificationEmail, sendAccountDeletionEmail } from "./email";

/** Grace period before a soft-deleted account is purged for good. */
const ACCOUNT_DELETION_GRACE_DAYS = 7;
import { callMistral, extractMemories } from "./mistral";
import { adminLog, getAdminLogs, formatAdminLogsText, clearAdminLogs, isAdminUser, isOwnerUsername, STAFF_ROLE_MISSIONS, type StaffRole } from "./admin-log";

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

  const { token, maxAge } = await createSession(env, id, undefined, request.headers.get("User-Agent"));
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
  if (user.banned_at) return err("This account has been banned.", 403);

  const { token, maxAge } = await createSession(env, user.id, undefined, request.headers.get("User-Agent"));
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
  await purgeAccountsPastGrace(env).catch(() => {});
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if ((user as any).banned_at) {
    try { await destroyAllSessionsForUser(env, user.id); } catch { /* ignore */ }
    return err("This account has been banned.", 403);
  }
  // If this account’s grace period already elapsed, finish the hard delete now.
  if (user.deletion_requested_at) {
    const purgeAt = new Date(user.deletion_requested_at).getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() >= purgeAt) {
      await hardDeleteUser(env, user.id).catch(() => {});
      return err("Not authenticated.", 401);
    }
  }
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
async function handleGuestLogin(request: Request, env: Env): Promise<Response> {
  // Opportunistic cleanup of expired guest sessions / abandoned guest accounts.
  await purgeExpiredGuestData(env).catch(() => {});

  const id = crypto.randomUUID();
  const username = `guest_${randomToken(6)}`;
  await env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, password_salt, theme, model, instructions, is_guest, created_at)
     VALUES (?, ?, NULL, '', '', 'system', ?, ?, 1, ?)`
  )
    .bind(id, username, DEFAULT_MODEL, DEFAULT_INSTRUCTIONS, nowIso())
    .run();

  // Guest sessions hard-expire after one month (not extended on activity).
  const { token, maxAge } = await createSession(env, id, GUEST_SESSION_DAYS, request.headers.get("User-Agent"));
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
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
    session_expires_at: expiresAt,
    session_days: GUEST_SESSION_DAYS,
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
  // through Google untouched. The state is HMAC-signed (see signOauthState), so
  // the callback can verify it even when the browser refuses to send the
  // oauth_state cookie back on the cross-site callback hop — that dropped cookie
  // is exactly why "Connect Google" kept failing with "Invalid OAuth state".
  const payload = mode === "link" ? `link:${linkUserId}:${randomToken(16)}` : `${mode}:${randomToken(16)}`;
  const state = await signOauthState(env, payload);
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

  // Accept the state when either the cookie round-tripped OR the signature checks
  // out. Signature-only is the normal path on phones and in incognito.
  const stateOk = !!state && (state === savedState || (await verifyOauthState(env, state)));
  if (!code || !stateOk) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }
  const mode = state!.startsWith("link:") ? "link" : "login";

  const accessToken = await exchangeCodeForAccessToken(env, code);
  const info = await fetchGoogleUserInfo(accessToken);

  // ---- Linking a Google account to the currently logged-in user ----
  if (mode === "link") {
    const clearState = clearOauthStateCookieHeader();
    const stateUserId = state!.split(":")[1] || "";
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

  const { token, maxAge } = await createSession(env, user.id, undefined, request.headers.get("User-Agent"));
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
  let results: { token: string; created_at: string; expires_at: string; user_agent?: string | null }[] = [];
  try {
    const q = await env.DB.prepare(
      `SELECT token, created_at, expires_at, user_agent FROM sessions
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC`
    )
      .bind(user.id, nowIso())
      .all<{ token: string; created_at: string; expires_at: string; user_agent: string | null }>();
    results = q.results || [];
  } catch {
    const q = await env.DB.prepare(
      `SELECT token, created_at, expires_at FROM sessions
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC`
    )
      .bind(user.id, nowIso())
      .all<{ token: string; created_at: string; expires_at: string }>();
    results = q.results || [];
  }

  const sessions = results.map((s) => ({
    id: s.token.slice(0, 8),
    token_prefix: s.token.slice(0, 8),
    created_at: s.created_at,
    expires_at: s.expires_at,
    is_current: s.token === currentToken,
    device: summarizeUserAgent(s.user_agent),
    user_agent: s.user_agent || null,
  }));

  return json(sessions);
}

// Revokes (deletes) a single session by its token prefix. The current
// session cannot be revoked this way — use /api/auth/logout instead.
/** Log out every device: wipe all sessions for this user (including current). */
async function handleLogoutAllSessions(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  return json({ ok: true });
}

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
/**
 * Hard-delete one user and all associated rows. Used after the 7-day grace
 * period (and for any force-purge path). Cascade covers most children; we
 * still clean tables that may not cascade on every deployment.
 */
async function hardDeleteUser(env: Env, userId: string): Promise<void> {
  await destroyAllSessionsForUser(env, userId);
  try {
    await env.DB.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)").bind(userId).run();
  } catch { /* older schemas */ }
  await env.DB.prepare("DELETE FROM conversations WHERE user_id = ?").bind(userId).run();
  try {
    await env.DB.prepare("DELETE FROM memories WHERE user_id = ?").bind(userId).run();
  } catch { /* optional table */ }
  try {
    await env.DB.prepare("DELETE FROM leads WHERE user_id = ?").bind(userId).run();
  } catch { /* optional */ }
  try {
    await env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(userId).run();
  } catch { /* optional */ }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
}

/** Purge accounts whose soft-delete grace period has elapsed. */
async function purgeAccountsPastGrace(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= ? LIMIT 25`
    )
      .bind(cutoff)
      .all<{ id: string }>();
    for (const row of results || []) {
      try {
        await hardDeleteUser(env, row.id);
      } catch (e) {
        console.error("purgeAccountsPastGrace failed for", row.id, e);
      }
    }
  } catch {
    // Column may not exist until migration 0008 is applied.
  }
}

/**
 * Soft-delete: mark the account for removal in 7 days, keep the session so
 * the user can still use the app and cancel. Emails a Resend notice when an
 * address is on file.
 */
async function handleDeleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  await purgeAccountsPastGrace(env).catch(() => {});

  if (user.deletion_requested_at) {
    const purgeAt = new Date(
      new Date(user.deletion_requested_at).getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    return json({
      ok: true,
      soft: true,
      already_pending: true,
      deletion_requested_at: user.deletion_requested_at,
      purge_at: purgeAt,
      email_sent: false,
    });
  }

  const now = nowIso();
  try {
    await env.DB.prepare("UPDATE users SET deletion_requested_at = ? WHERE id = ?").bind(now, user.id).run();
  } catch {
    return err(
      "Account deletion requires a database update (run migration 0008_account_deletion). Contact the admin.",
      500
    );
  }

  const purgeAt = new Date(
    Date.now() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  let emailSent = false;
  if (user.email && env.RESEND_API_KEY) {
    const settingsUrl = `${(env.FRONTEND_URL || "https://ai.afmarbre.com").replace(/\/$/, "")}/#settings=account`;
    try {
      await sendAccountDeletionEmail(env, user.email, {
        username: user.display_name || user.username,
        purgeAt,
        settingsUrl,
      });
      emailSent = true;
    } catch (e) {
      console.error("Failed to send account deletion email", e);
    }
  }

  // Session stays alive — user can keep using the app and cancel.
  const refreshed = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first<any>();
  return json({
    ok: true,
    soft: true,
    deletion_requested_at: now,
    purge_at: purgeAt,
    email_sent: emailSent,
    user: refreshed ? toPublicUser(refreshed) : toPublicUser({ ...user, deletion_requested_at: now } as any),
  });
}

/** Cancel a pending soft-delete during the grace period. */
async function handleCancelDeletion(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (!user.deletion_requested_at) {
    return json({ ok: true, user: toPublicUser(user), cancelled: false });
  }
  try {
    await env.DB.prepare("UPDATE users SET deletion_requested_at = NULL WHERE id = ?").bind(user.id).run();
  } catch {
    return err("Could not cancel deletion.", 500);
  }
  const refreshed = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first<any>();
  return json({ ok: true, cancelled: true, user: refreshed ? toPublicUser(refreshed) : toPublicUser({ ...user, deletion_requested_at: null } as any) });
}

// ---- Memory ---------------------------------------------------------
// Paul's cross-chat memory. Durable facts live in `memories` and get injected
// into the first turn of every new conversation, so he remembers what was said
// in other chats. `users.memory_enabled` is the "Generate memory from chats"
// switch in Settings > Memory.
interface MemoryRow {
  id: string;
  title: string;
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
}

async function listMemoryRows(env: Env, userId: string): Promise<MemoryRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, content, source, created_at, updated_at
       FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200`
  )
    .bind(userId)
    .all<MemoryRow>();
  return results || [];
}

function memoryEnabled(user: any): boolean {
  return user.memory_enabled === undefined || user.memory_enabled === null
    ? true
    : Number(user.memory_enabled) === 1;
}

/** The block prepended to the first message of a new conversation. */
export function buildMemoryPreamble(rows: MemoryRow[]): string {
  if (!rows.length) return "";
  const lines = rows.map((r) => `- ${r.title}: ${r.content}`).join("\n");
  return `[Known about this user from previous conversations — use it naturally, never mention this list]\n${lines}\n\n`;
}

/** Insert or update one memory entry, keyed on (user, title). */
async function upsertMemory(
  env: Env,
  userId: string,
  item: { title: string; content: string },
  source: string
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO memories (id, user_id, title, content, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, title) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
  )
    .bind(crypto.randomUUID(), userId, item.title.slice(0, 60), item.content.slice(0, 600), source, now, now)
    .run();
}

async function handleListMemory(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  return json({ enabled: memoryEnabled(user), memories: await listMemoryRows(env, user.id) });
}

async function handleMemorySettings(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = body.enabled ? 1 : 0;
  await env.DB.prepare("UPDATE users SET memory_enabled = ? WHERE id = ?").bind(enabled, user.id).run();
  return json({ enabled: enabled === 1 });
}

async function handleCreateMemory(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => ({}))) as { title?: string; content?: string };
  const title = (body.title || "").trim();
  const content = (body.content || "").trim();
  if (!content) return err("Write what Paul should remember.", 400);
  await upsertMemory(env, user.id, { title: title || content.slice(0, 40), content }, "manual");
  return json({ memories: await listMemoryRows(env, user.id) });
}

async function handleDeleteMemory(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  await env.DB.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  return json({ memories: await listMemoryRows(env, user.id) });
}

/** PATCH /api/memory/:id — user edits title/content directly (no AI). */
async function handleUpdateMemory(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => ({}))) as { title?: string; content?: string };
  const title = (body.title ?? "").trim();
  const content = (body.content ?? "").trim();
  if (!title && !content) return err("Title and content cannot both be empty.", 400);
  const row = await env.DB.prepare("SELECT id FROM memories WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!row) return err("Memory entry not found.", 404);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE memories SET title = ?, content = ?, source = 'manual', updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind((title || content.slice(0, 40)).slice(0, 60), content.slice(0, 600) || title, now, id, user.id)
    .run();
  return json({ memories: await listMemoryRows(env, user.id) });
}

/**
 * POST /api/memory/revise  { id, instruction }
 * Paul rewrites (or deletes) one memory entry from a natural-language request,
 * so the settings UI can offer "tell Paul what to change" instead of a form.
 */
async function handleReviseMemory(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (!env.MISTRAL_API_KEY) return err("Memory is not configured on this deployment.", 501);

  const body = (await request.json().catch(() => ({}))) as { id?: string; instruction?: string };
  const id = (body.id || "").trim();
  const instruction = (body.instruction || "").trim();
  if (!id) return err("Missing memory id.", 400);
  if (!instruction) return err("Tell Paul what to change or remove.", 400);

  const row = await env.DB.prepare(
    "SELECT id, title, content FROM memories WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first<{ id: string; title: string; content: string }>();
  if (!row) return err("Memory entry not found.", 404);

  const prompt = `You maintain long-term memory entries for an assistant app.
Apply the user's instruction to the memory entry below.

Current title: ${row.title}
Current content:
${row.content}

User instruction:
${instruction.slice(0, 800)}

Reply with JSON only, one of:
{"action":"update","title":"Short topic","content":"Revised content, 1-4 sentences."}
{"action":"delete"}

Rules:
- If the user asks to forget / remove / delete this memory, use action delete.
- Otherwise return a clear updated title (max 60 chars) and content (max 600 chars).
- Keep durable facts; drop one-off or time-bound details the user asked to remove.
- Do not invent new facts the user did not imply.`;

  try {
    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 200);
      return err(`Could not revise memory (${resp.status}): ${detail}`, 502);
    }
    const data: any = await resp.json();
    const raw = data?.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw : "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err("Could not parse memory revision.", 502);
    }

    if (parsed?.action === "delete") {
      await env.DB.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      return json({ deleted: true, memories: await listMemoryRows(env, user.id) });
    }

    const newTitle = String(parsed?.title || row.title).trim().slice(0, 60) || row.title;
    const newContent = String(parsed?.content || row.content).trim().slice(0, 600);
    if (!newContent) return err("Revised content was empty.", 400);

    const now = new Date().toISOString();
    // If the title changed, avoid unique(user,title) conflicts by deleting old then upserting.
    if (newTitle !== row.title) {
      await env.DB.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      await upsertMemory(env, user.id, { title: newTitle, content: newContent }, "manual");
    } else {
      await env.DB.prepare(
        "UPDATE memories SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      )
        .bind(newContent, now, id, user.id)
        .run();
    }
    return json({ deleted: false, memories: await listMemoryRows(env, user.id) });
  } catch (e: any) {
    return err("Memory revision failed: " + (e?.message || "Unknown error."), 500);
  }
}

// "Manage memory" replaced the old download-a-txt-file behaviour: this now reads
// the recent history and stores structured entries Paul can actually reuse.
async function handleGenerateMemory(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  if (!env.MISTRAL_API_KEY) {
    return err("Memory is not configured on this deployment.", 500);
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT m.content FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
       ORDER BY m.created_at DESC LIMIT 100`
    )
      .bind(user.id)
      .all<{ content: string }>();

    if (!results || results.length === 0) {
      return err("No conversation history found to build memory from.", 400);
    }

    const existing = (await listMemoryRows(env, user.id)).map((r) => ({ title: r.title, content: r.content }));
    const items = await extractMemories(env.MISTRAL_API_KEY, {
      userMessage: results.map((r) => r.content).join("\n\n").slice(0, 12000),
      reply: "",
      existing,
    });
    for (const item of items) await upsertMemory(env, user.id, item, "chat");
    return json({ added: items.length, memories: await listMemoryRows(env, user.id) });
  } catch (e: any) {
    return err("Memory update encountered an error: " + (e?.message || "Unknown error."), 500);
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
 * Preferred order:
 *   1. Cloudflare AI  elevenlabs/eleven-multilingual-v2  (env.AI binding)
 *      https://developers.cloudflare.com/ai/models/elevenlabs/eleven-multilingual-v2/
 *   2. Same model via REST (CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID)
 *   3. ElevenLabs direct API (ELEVENLABS_API_KEY)
 *   4. Workers AI fallbacks: MeloTTS, Deepgram Aura
 * When none work → 501 so the app falls back to the device voice.
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
  const input = text.slice(0, 4000);

  const voiceId =
    typeof body?.voiceId === "string" && /^[A-Za-z0-9]{8,40}$/.test(body.voiceId)
      ? body.voiceId
      : "JBFqnCBsd6RMkjVDRZzb"; // ElevenLabs George (docs default)
  const speedRaw = Number(body?.speed);
  const speed = Number.isFinite(speedRaw) ? Math.min(1.2, Math.max(0.7, speedRaw)) : 1.0;
  const language = typeof body?.language === "string" ? body.language : "en";
  const lang2 = (language.split("-")[0] || "en").toLowerCase();

  const audio = (stream: BodyInit) =>
    new Response(stream, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });

  function bytesFromBase64(b64: string): Uint8Array {
    const pure = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
    const binary = atob(pure);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** Resolve audio from CF / partner responses: base64, data URI, or https URL. */
  async function resolveAudioPayload(data: any): Promise<Uint8Array | null> {
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer as ArrayBuffer);

    const candidates: unknown[] = [
      data,
      data.audio,
      data.result,
      data.result?.audio,
      data.result?.audio_base64,
      data.audio_base64,
    ];

    for (const c of candidates) {
      if (typeof c !== "string" || c.length < 16) continue;
      // HTTPS URL returned by some CF partner / gateway responses
      if (/^https?:\/\//i.test(c)) {
        try {
          const r = await fetch(c);
          if (r.ok) {
            const buf = await r.arrayBuffer();
            if (buf.byteLength > 64) return new Uint8Array(buf);
          }
        } catch {
          /* try next */
        }
        continue;
      }
      // data:audio/...;base64,... or raw base64
      if (c.startsWith("data:") || /^[A-Za-z0-9+/=\s]+$/.test(c.slice(0, 80))) {
        try {
          const bytes = bytesFromBase64(c);
          if (bytes.length > 64) return bytes;
        } catch {
          /* try next */
        }
      }
    }
    return null;
  }

  // Payload matching Cloudflare AI docs for elevenlabs/eleven-multilingual-v2
  const elevenCfPayload = {
    text: input,
    voice_id: voiceId,
    language_code: lang2,
    output_format: "mp3_44100_128",
  };

  const elevenCfModel =
    env.TTS_MODEL?.trim() || "elevenlabs/eleven-multilingual-v2";

  let lastDetail = "";

  // --- Path 1: Cloudflare AI binding (env.AI) — official CF ElevenLabs path
  if (env.AI && typeof env.AI.run === "function") {
    try {
      const result = await env.AI.run(elevenCfModel, elevenCfPayload);
      const bytes = await resolveAudioPayload(result);
      if (bytes && bytes.length) return audio(bytes);
      if (result && typeof (result as any).arrayBuffer === "function") {
        const buf = await (result as Response).arrayBuffer();
        if (buf.byteLength > 64) return audio(new Uint8Array(buf));
      }
      lastDetail = `CF ElevenLabs binding empty: ${JSON.stringify(result)?.slice(0, 220)}`;
      console.log("TTS: CF ElevenLabs binding empty", lastDetail);
    } catch (e: any) {
      lastDetail = String(e?.message || e).slice(0, 300);
      console.log("TTS: CF ElevenLabs binding failed", lastDetail);
    }
  }

  // --- Path 2: Cloudflare AI REST
  // Docs curl: POST /accounts/$ID/ai/run  { model, input }
  // Also try /ai/run/$MODEL with body = input fields.
  const cfToken = env.CLOUDFLARE_AI_TOKEN?.trim();
  const cfAccount = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (cfToken && cfAccount) {
    const attempts: Array<{ url: string; body: unknown }> = [
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run`,
        body: { model: elevenCfModel, input: elevenCfPayload },
      },
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/${elevenCfModel}`,
        body: elevenCfPayload,
      },
    ];
    for (const attempt of attempts) {
      try {
        const resp = await fetch(attempt.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(attempt.body),
        });
        if (resp.ok) {
          const contentType = resp.headers.get("Content-Type") || "";
          if (contentType.includes("application/json")) {
            const data: any = await resp.json().catch(() => null);
            const bytes = await resolveAudioPayload(data);
            if (bytes && bytes.length) return audio(bytes);
            lastDetail = `CF REST JSON no audio: ${JSON.stringify(data)?.slice(0, 220)}`;
          } else if (contentType.includes("audio") || contentType.includes("octet-stream")) {
            return audio(resp.body!);
          } else {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength > 64) return audio(new Uint8Array(buf));
            lastDetail = "CF REST ok but empty body";
          }
        } else {
          lastDetail = (await resp.text().catch(() => "")).slice(0, 300);
          console.log("TTS: CF ElevenLabs REST failed", resp.status, lastDetail);
        }
      } catch (e: any) {
        lastDetail = String(e?.message || e).slice(0, 300);
        console.log("TTS: CF ElevenLabs REST exception", lastDetail);
      }
    }
  }

  // --- Path 3: ElevenLabs direct API (optional own key)
  const elevenKey = env.ELEVENLABS_API_KEY?.trim();
  if (elevenKey) {
    const models = Array.from(
      new Set(
        [
          env.ELEVENLABS_MODEL?.trim(),
          "eleven_multilingual_v2",
          "eleven_turbo_v2_5",
          "eleven_flash_v2_5",
        ].filter(Boolean) as string[]
      )
    );
    for (const model of models) {
      for (const withSpeed of [true, false]) {
        try {
          const resp = await fetch(
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
                model_id: model,
                language_code: lang2 === "en" ? undefined : lang2,
                voice_settings: {
                  stability: 0.5,
                  similarity_boost: 0.75,
                  use_speaker_boost: true,
                  ...(withSpeed ? { speed } : {}),
                },
              }),
            }
          );
          if (resp.ok) return audio(resp.body!);
          lastDetail = (await resp.text().catch(() => "")).slice(0, 300);
          console.log("TTS: ElevenLabs direct failed", model, withSpeed, resp.status, lastDetail);
          if ([401, 402, 403, 429].includes(resp.status)) break;
        } catch (e: any) {
          lastDetail = String(e?.message || e).slice(0, 300);
          console.log("TTS: ElevenLabs direct exception", lastDetail);
        }
      }
    }
  }

  // --- Path 4: Workers AI host models (free-ish fallback)
  const fallbackModels = [
    "@cf/myshell-ai/melotts",
    lang2 === "es" ? "@cf/deepgram/aura-2-es" : "@cf/deepgram/aura-2-en",
    "@cf/deepgram/aura-1",
  ];
  function payloadForFallback(model: string): Record<string, unknown> {
    if (model.includes("melotts")) return { prompt: input, lang: lang2 };
    return { text: input };
  }

  if (env.AI && typeof env.AI.run === "function") {
    for (const model of fallbackModels) {
      const bindingId = model.replace(/^@cf\//, "");
      try {
        const result = await env.AI.run(bindingId, payloadForFallback(model));
        const bytes = await resolveAudioPayload(result);
        if (bytes && bytes.length) return audio(bytes);
        lastDetail = `fallback binding empty ${bindingId}`;
      } catch (e: any) {
        lastDetail = String(e?.message || e).slice(0, 300);
        console.log("TTS: fallback binding failed", bindingId, lastDetail);
      }
    }
  }

  if (cfToken && cfAccount) {
    for (const model of fallbackModels) {
      const restModel = model.startsWith("@cf/") ? model : `@cf/${model}`;
      try {
        const resp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/${restModel}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cfToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payloadForFallback(model)),
          }
        );
        if (resp.ok) {
          const contentType = resp.headers.get("Content-Type") || "";
          if (contentType.includes("application/json")) {
            const data: any = await resp.json().catch(() => null);
            const bytes = await resolveAudioPayload(data);
            if (bytes && bytes.length) return audio(bytes);
          } else {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength > 64) return audio(new Uint8Array(buf));
          }
        }
        lastDetail = (await resp.text().catch(() => "")).slice(0, 200);
      } catch (e: any) {
        lastDetail = String(e?.message || e).slice(0, 300);
      }
    }
  }

  console.log("TTS: all paths failed", lastDetail);
  return err("High-quality voice isn't available right now. Using device voice.", 501);
}

/**
 * GET /api/admin/logs — download recent Worker logs (admin username only).
 * DELETE /api/admin/logs — clear the in-memory buffer.
 */
async function handleAdminLogsGet(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: "Not authenticated" }, 401);
  if (!isAdminUser(user.username)) return json({ error: "Forbidden" }, 403);
  const format = new URL(request.url).searchParams.get("format") || "text";
  const entries = getAdminLogs();
  adminLog("info", "admin", "logs downloaded", { count: entries.length, by: user.username });
  if (format === "json") {
    return json({ count: entries.length, logs: entries });
  }
  const body = formatAdminLogsText(entries) || "(no log entries yet)\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="paul-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt"`,
    },
  });
}

async function handleAdminLogsClear(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: "Not authenticated" }, 401);
  if (!isAdminUser(user.username)) return json({ error: "Forbidden" }, 403);
  const cleared = clearAdminLogs();
  adminLog("info", "admin", "logs cleared", { cleared, by: user.username });
  return json({ ok: true, cleared });
}

/** GET /api/admin/users — list + online + ban flags (admin only) */
async function handleAdminUsers(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: "Not authenticated" }, 401);
  const staffRole = await getStaffRole(env, user.id, user.username);
  if (!canManageUsers(staffRole)) return json({ error: "Forbidden" }, 403);
  await ensureConversationColumns(env);

  let onlineIds = new Set<string>();
  try {
    if (env.PRESENCE) {
      const id = env.PRESENCE.idFromName("global");
      const stub = env.PRESENCE.get(id);
      const snap = await stub.fetch("https://presence/snapshot");
      if (snap.ok) {
        const data: any = await snap.json();
        for (const o of data.online || []) if (o.user_id) onlineIds.add(o.user_id);
      }
    }
  } catch { /* presence optional */ }

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    let results: any[] = [];
    if (q) {
      const like = `%${q}%`;
      const r = await env.DB.prepare(
        `SELECT id, username, email, display_name, is_guest, created_at, last_seen_at, deletion_requested_at, banned_at
         FROM users
         WHERE lower(username) LIKE ? OR lower(COALESCE(email,'')) LIKE ? OR lower(COALESCE(display_name,'')) LIKE ?
         ORDER BY created_at DESC LIMIT 200`
      ).bind(like, like, like).all();
      results = r.results || [];
    } else {
      const r = await env.DB.prepare(
        `SELECT id, username, email, display_name, is_guest, created_at, last_seen_at, deletion_requested_at, banned_at
         FROM users ORDER BY created_at DESC LIMIT 200`
      ).all();
      results = r.results || [];
    }
    return json({
      users: (results || []).map((r: any) => ({
        ...r,
        online: onlineIds.has(r.id),
        banned: !!r.banned_at,
      })),
    });
  } catch {
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, username, email, display_name, is_guest, created_at, last_seen_at, deletion_requested_at
         FROM users ORDER BY created_at DESC LIMIT 200`
      ).all();
      return json({
        users: (results || []).map((r: any) => ({
          ...r,
          online: onlineIds.has(r.id),
          banned: false,
        })),
      });
    } catch {
      const { results } = await env.DB.prepare(
        `SELECT id, username, email, display_name, is_guest, created_at FROM users ORDER BY created_at DESC LIMIT 200`
      ).all();
      return json({
        users: (results || []).map((r: any) => ({
          ...r,
          online: onlineIds.has(r.id),
          banned: false,
        })),
      });
    }
  }
}


async function handleAdminUserDetail(request: Request, env: Env, targetId: string): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, admin.id, admin.username);
  if (!canManageUsers(staffRole)) return err("Forbidden.", 403);
  await ensureConversationColumns(env);

  const target = await env.DB.prepare(
    `SELECT id, username, email, display_name, is_guest, created_at, last_seen_at, deletion_requested_at, banned_at, avatar
     FROM users WHERE id = ?`
  )
    .bind(targetId)
    .first<any>();
  if (!target) return err("User not found.", 404);

  // Conversations owned or member
  let conversations: any[] = [];
  try {
    const owned = await env.DB.prepare(
      `SELECT id, title, visibility, created_at, updated_at, 'owner' AS relation
       FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
    )
      .bind(targetId)
      .all();
    conversations = (owned.results || []).map((r: any) => r);
    try {
      const mem = await env.DB.prepare(
        `SELECT c.id, c.title, c.visibility, c.created_at, c.updated_at, 'member' AS relation
         FROM conversation_members m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.user_id = ? AND c.user_id != ?
         ORDER BY c.updated_at DESC LIMIT 50`
      )
        .bind(targetId, targetId)
        .all();
      for (const r of mem.results || []) conversations.push(r);
    } catch { /* ignore */ }
  } catch { conversations = []; }

  // Messages sent by user
  let message_count = 0;
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE sender_user_id = ?"
    )
      .bind(targetId)
      .first<{ n: number }>();
    message_count = Number(row?.n || 0);
  } catch {
    try {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND m.role = 'user'`
      )
        .bind(targetId)
        .first<{ n: number }>();
      message_count = Number(row?.n || 0);
    } catch { message_count = 0; }
  }

  // Uploaded files (attachments on their messages)
  const files: any[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT m.id AS message_id, m.attachments, m.created_at, m.conversation_id, c.title AS conversation_title
       FROM messages m
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE m.sender_user_id = ? AND m.attachments IS NOT NULL AND m.attachments != '' AND m.attachments != '[]'
       ORDER BY m.created_at DESC LIMIT 200`
    )
      .bind(targetId)
      .all();
    for (const row of results || []) {
      const r = row as any;
      let atts: any[] = [];
      try {
        atts = JSON.parse(r.attachments);
      } catch {
        continue;
      }
      if (!Array.isArray(atts)) continue;
      for (const a of atts) {
        files.push({
          name: a.name || "file",
          mime: a.mime || "application/octet-stream",
          size: a.size || 0,
          created_at: r.created_at,
          conversation_id: r.conversation_id,
          conversation_title: r.conversation_title || null,
          message_id: r.message_id,
          has_data: !!(a.dataUrl && String(a.dataUrl).length > 32),
        });
      }
    }
  } catch { /* ignore */ }

  return json({
    user: {
      ...target,
      banned: !!target.banned_at,
    },
    stats: {
      conversations: conversations.length,
      messages: message_count,
      files: files.length,
    },
    conversations,
    files,
  });
}

async function handleAdminUserExport(request: Request, env: Env, targetId: string): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, admin.id, admin.username);
  if (!canManageUsers(staffRole)) return err("Forbidden.", 403);
  await ensureConversationColumns(env);

  const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
  if (!target) return err("User not found.", 404);

  // Strip secrets
  const safeUser = { ...target };
  delete safeUser.password_hash;
  delete safeUser.password_salt;

  let conversations: any[] = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500"
    )
      .bind(targetId)
      .all();
    conversations = results || [];
  } catch { conversations = []; }

  const convoIds = conversations.map((c) => c.id);
  // Also member convos
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.* FROM conversation_members m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.user_id = ? LIMIT 200`
    )
      .bind(targetId)
      .all();
    for (const c of results || []) {
      if (!convoIds.includes((c as any).id)) {
        conversations.push(c);
        convoIds.push((c as any).id);
      }
    }
  } catch { /* ignore */ }

  let messages: any[] = [];
  if (convoIds.length) {
    // Batch in chunks of 50
    for (let i = 0; i < convoIds.length; i += 40) {
      const chunk = convoIds.slice(i, i + 40);
      const placeholders = chunk.map(() => "?").join(",");
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, conversation_id, role, content, attachments, created_at, sender_user_id, edited_at, deleted_at
           FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY created_at ASC LIMIT 5000`
        )
          .bind(...chunk)
          .all();
        messages = messages.concat(results || []);
      } catch { /* ignore */ }
    }
  }

  // Messages they sent even if not owner
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, conversation_id, role, content, attachments, created_at, sender_user_id, edited_at, deleted_at
       FROM messages WHERE sender_user_id = ? ORDER BY created_at ASC LIMIT 5000`
    )
      .bind(targetId)
      .all();
    const seen = new Set(messages.map((m) => m.id));
    for (const m of results || []) {
      if (!seen.has((m as any).id)) messages.push(m);
    }
  } catch { /* ignore */ }

  const payload = {
    exported_at: new Date().toISOString(),
    exported_by: admin.username,
    user: safeUser,
    conversations,
    messages,
  };

  adminLog("info", "admin", "user export", { target: target.username, by: admin.username });
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="paul-user-${target.username || targetId}.json"`,
    },
  });
}

async function handleAdminBanUser(request: Request, env: Env, targetId: string): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, admin.id, admin.username);
  if (!canManageUsers(staffRole)) return err("Forbidden.", 403);
  await ensureConversationColumns(env);
  if (targetId === admin.id) return err("You can't ban yourself.", 400);
  const body = (await request.json().catch(() => null)) as { ban?: boolean } | null;
  const ban = body?.ban !== false;
  const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?")
    .bind(targetId)
    .first<{ id: string; username: string }>();
  if (!target) return err("User not found.", 404);
  if (isAdminUser(target.username)) return err("Can't ban an admin account.", 400);
  if (ban) {
    try {
      await env.DB.prepare("UPDATE users SET banned_at = ? WHERE id = ?").bind(nowIso(), targetId).run();
    } catch {
      return err("Ban column missing — redeploy so schema migrates.", 500);
    }
    try { await destroyAllSessionsForUser(env, targetId); } catch { /* ignore */ }
    adminLog("info", "admin", "user banned", { target: target.username, by: admin.username });
    return json({ ok: true, banned: true });
  }
  await env.DB.prepare("UPDATE users SET banned_at = NULL WHERE id = ?").bind(targetId).run();
  adminLog("info", "admin", "user unbanned", { target: target.username, by: admin.username });
  return json({ ok: true, banned: false });
}

async function handleAdminSetPassword(request: Request, env: Env, targetId: string): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, admin.id, admin.username);
  if (staffRole !== "owner") return err("Forbidden.", 403);
  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  const password = (body?.password || "").trim();
  if (password.length < 8) return err("Password must be at least 8 characters.", 400);
  const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?")
    .bind(targetId)
    .first<{ id: string; username: string }>();
  if (!target) return err("User not found.", 404);
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, targetId)
    .run();
  adminLog("info", "admin", "password set", { target: target.username, by: admin.username });
  return json({ ok: true });
}

async function handleAdminDeleteUser(request: Request, env: Env, targetId: string): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, admin.id, admin.username);
  if (staffRole !== "owner") return err("Forbidden.", 403);
  if (targetId === admin.id) return err("You can't delete yourself.", 400);
  const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?")
    .bind(targetId)
    .first<{ id: string; username: string }>();
  if (!target) return err("User not found.", 404);
  if (isAdminUser(target.username)) return err("Can't delete an admin account.", 400);
  try { await destroyAllSessionsForUser(env, targetId); } catch { /* ignore */ }
  const stmts: [string, number][] = [
    ["DELETE FROM sessions WHERE user_id = ?", 1],
    ["DELETE FROM conversation_members WHERE user_id = ?", 1],
    ["DELETE FROM conversation_reads WHERE user_id = ?", 1],
    ["DELETE FROM friendships WHERE user_a = ? OR user_b = ?", 2],
    ["DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?", 2],
    ["DELETE FROM memories WHERE user_id = ?", 1],
    ["DELETE FROM leads WHERE user_id = ?", 1],
    ["DELETE FROM messages WHERE sender_user_id = ?", 1],
    ["DELETE FROM conversations WHERE user_id = ?", 1],
    ["DELETE FROM users WHERE id = ?", 1],
  ];
  for (const [sql, n] of stmts) {
    try {
      if (n === 2) await env.DB.prepare(sql).bind(targetId, targetId).run();
      else await env.DB.prepare(sql).bind(targetId).run();
    } catch { /* ignore */ }
  }
  adminLog("info", "admin", "user deleted", { target: target.username, by: admin.username });
  return json({ ok: true, deleted: true });
}


async function getStaffRole(env: Env, userId: string, username: string): Promise<StaffRole | null> {
  if (isOwnerUsername(username)) return "owner";
  try {
    await ensureConversationColumns(env);
    const row = await env.DB.prepare("SELECT role FROM admin_staff WHERE user_id = ?")
      .bind(userId)
      .first<{ role: string }>();
    const r = (row?.role || "").toLowerCase();
    if (r === "owner" || r === "moderator" || r === "catalog") return r as StaffRole;
  } catch { /* ignore */ }
  return null;
}

function canManageUsers(role: StaffRole | null): boolean {
  return role === "owner" || role === "moderator";
}
function canManageCatalog(role: StaffRole | null): boolean {
  return role === "owner" || role === "catalog";
}
function canManageRoles(role: StaffRole | null): boolean {
  return role === "owner";
}
function canViewAdminLogs(role: StaffRole | null): boolean {
  return role === "owner";
}

async function handleListStaff(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const role = await getStaffRole(env, user.id, user.username);
  if (!role) return err("Forbidden.", 403);
  await ensureConversationColumns(env);
  let staff: any[] = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT user_id, username, role, created_at FROM admin_staff ORDER BY created_at ASC"
    ).all();
    staff = results || [];
  } catch { staff = []; }
  // Always surface built-in owners
  for (const uname of ["fayt7304", "fay7304"]) {
    if (!staff.some((s) => (s.username || "").toLowerCase() === uname)) {
      staff.unshift({ user_id: null, username: uname, role: "owner", created_at: null, built_in: true });
    }
  }
  return json({
    staff,
    me: { role, missions: STAFF_ROLE_MISSIONS },
    missions: STAFF_ROLE_MISSIONS,
  });
}

async function handleAssignStaff(request: Request, env: Env): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const myRole = await getStaffRole(env, admin.id, admin.username);
  if (!canManageRoles(myRole)) return err("Only owners can assign roles.", 403);
  await ensureConversationColumns(env);
  const body = (await request.json().catch(() => null)) as { username?: string; role?: string } | null;
  const username = (body?.username || "").trim().toLowerCase();
  const role = (body?.role || "").trim().toLowerCase() as StaffRole;
  if (!username) return err("Username required.", 400);
  if (!["owner", "moderator", "catalog"].includes(role)) return err("Role must be owner, moderator, or catalog.", 400);
  const target = await env.DB.prepare("SELECT id, username FROM users WHERE lower(username) = ?")
    .bind(username)
    .first<{ id: string; username: string }>();
  if (!target) return err("User not found.", 404);
  await env.DB.prepare(
    `INSERT INTO admin_staff (user_id, username, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, username = excluded.username`
  )
    .bind(target.id, target.username, role, nowIso())
    .run();
  adminLog("info", "admin", "role assigned", { target: target.username, role, by: admin.username });
  return json({ ok: true, user_id: target.id, username: target.username, role });
}

async function handleRemoveStaff(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await getUserFromRequest(env, request);
  if (!admin) return err("Not authenticated.", 401);
  const myRole = await getStaffRole(env, admin.id, admin.username);
  if (!canManageRoles(myRole)) return err("Only owners can remove roles.", 403);
  if (userId === admin.id) return err("You can't remove your own role here.", 400);
  await env.DB.prepare("DELETE FROM admin_staff WHERE user_id = ?").bind(userId).run();
  adminLog("info", "admin", "role removed", { target: userId, by: admin.username });
  return json({ ok: true });
}

async function handleCallLive(request: Request, env: Env, conversationId: string): Promise<Response> {
  if (!env.CALLS) return err("Calls Durable Object not configured.", 501);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || undefined;
  let user = await getUserFromRequest(env, request);
  if (!user && token) user = (await getUserFromToken(env, token)) as any;
  if (!user) return err("Not authenticated.", 401);
  // Access check: owner, member, or DM peer
  const convo = await env.DB.prepare(
    "SELECT id, user_id, visibility, dm_peer_id FROM conversations WHERE id = ?"
  )
    .bind(conversationId)
    .first<{ id: string; user_id: string; visibility: string; dm_peer_id: string | null }>();
  if (!convo) return err("Conversation not found.", 404);
  let allowed = convo.user_id === user.id || convo.dm_peer_id === user.id;
  if (!allowed) {
    try {
      const mem = await env.DB.prepare(
        "SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      )
        .bind(conversationId, user.id)
        .first();
      allowed = !!mem;
    } catch {
      allowed = false;
    }
  }
  if (!allowed) return err("Access forbidden.", 403);

  const id = env.CALLS.idFromName(conversationId);
  const stub = env.CALLS.get(id);
  const doUrl = new URL("https://call/live");
  doUrl.searchParams.set("userId", user.id);
  doUrl.searchParams.set("username", user.username || "user");
  return stub.fetch(doUrl.toString(), request);
}

async function handlePresenceLive(request: Request, env: Env): Promise<Response> {
  if (!env.PRESENCE) {
    return err("Presence Durable Object not configured. Deploy with PRESENCE binding.", 501);
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || undefined;
  let user = await getUserFromRequest(env, request);
  if (!user && token) {
    user = (await getUserFromToken(env, token)) as any;
  }
  if (!user) return err("Not authenticated.", 401);
  await touchPresence(env, user.id);
  const id = env.PRESENCE.idFromName("global");
  const stub = env.PRESENCE.get(id);
  const doUrl = new URL("https://presence/live");
  doUrl.searchParams.set("userId", user.id);
  doUrl.searchParams.set("username", user.username || "user");
  return stub.fetch(doUrl.toString(), request);
}

async function handlePresenceSnapshot(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (!env.PRESENCE) return json({ online: [], durable: false });
  try {
    const id = env.PRESENCE.idFromName("global");
    const stub = env.PRESENCE.get(id);
    const snap = await stub.fetch("https://presence/snapshot");
    const data: any = await snap.json();
    return json({ online: data.online || [], durable: true });
  } catch {
    return json({ online: [], durable: false });
  }
}


/** GET /api/usage/quota — daily message limit remaining for the signed-in user */
async function handleUsageQuota(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const dailyLimit = env.MAX_MESSAGES_PER_DAY ? parseInt(env.MAX_MESSAGES_PER_DAY, 10) : 0;
  let used = 0;
  if (dailyLimit > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user' AND m.created_at > ?`
    )
      .bind(user.id, since)
      .first<{ n: number }>();
    used = row?.n || 0;
  }
  return json({
    daily_limit: dailyLimit || null,
    used_today: used,
    remaining: dailyLimit > 0 ? Math.max(0, dailyLimit - used) : null,
    unlimited: !dailyLimit,
  });
}

/** Catalog / knowledge docs (admin write, any signed-in read) — v10.1 vector embeddings */
async function handleListKnowledge(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  await ensureKnowledgeSeed(env);
  await ensureConversationColumns(env);
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, title, content, tags, updated_at, embedding FROM knowledge_docs ORDER BY updated_at DESC"
    ).all();
    const docs = (results || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      tags: r.tags,
      updated_at: r.updated_at,
      has_embedding: !!(r.embedding && String(r.embedding).length > 10),
    }));
    return json({ docs, vector_ready: !!env.AI });
  } catch {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, title, content, tags, updated_at FROM knowledge_docs ORDER BY updated_at DESC"
      ).all();
      return json({
        docs: (results || []).map((r: any) => ({ ...r, has_embedding: false })),
        vector_ready: !!env.AI,
      });
    } catch {
      return json({ docs: [], vector_ready: !!env.AI });
    }
  }
}

async function handleUpsertKnowledge(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, user.id, user.username);
  if (!canManageCatalog(staffRole)) return err("Forbidden.", 403);
  await ensureKnowledgeSeed(env);
  await ensureConversationColumns(env);
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    title?: string;
    content?: string;
    tags?: string;
  } | null;
  const title = body?.title?.trim().slice(0, 200);
  const content = body?.content?.trim().slice(0, 50_000);
  if (!title || !content) return err("Title and content are required.", 400);
  const id = (body?.id || crypto.randomUUID()).slice(0, 64);
  const tags = (body?.tags || "").trim().slice(0, 500);
  const ts = nowIso();

  // Embed title + tags + content for vector retrieval
  const embedText = `${title}\n${tags}\n${content}`.slice(0, 8000);
  const vector = await embedTextWithWorkersAI(env, embedText);
  const embeddingJson = vector ? JSON.stringify(vector) : null;

  try {
    await env.DB.prepare(
      `INSERT INTO knowledge_docs (id, title, content, tags, updated_at, embedding) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, tags = excluded.tags, updated_at = excluded.updated_at, embedding = excluded.embedding`
    )
      .bind(id, title, content, tags, ts, embeddingJson)
      .run();
  } catch {
    await env.DB.prepare(
      `INSERT INTO knowledge_docs (id, title, content, tags, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, tags = excluded.tags, updated_at = excluded.updated_at`
    )
      .bind(id, title, content, tags, ts)
      .run();
  }
  adminLog("info", "knowledge", "doc upserted", {
    id,
    title,
    by: user.username,
    embedded: !!vector,
    dims: vector?.length || 0,
  });
  return json({ ok: true, id, title, updated_at: ts, embedded: !!vector });
}

async function handleDeleteKnowledge(request: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, user.id, user.username);
  if (!canManageCatalog(staffRole)) return err("Forbidden.", 403);
  await env.DB.prepare("DELETE FROM knowledge_docs WHERE id = ?").bind(id).run();
  adminLog("info", "knowledge", "doc deleted", { id, by: user.username });
  return json({ ok: true });
}

/** POST /api/knowledge/reindex — re-embed all catalog docs (admin) */
async function handleReindexKnowledge(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const staffRole = await getStaffRole(env, user.id, user.username);
  if (!canManageCatalog(staffRole)) return err("Forbidden.", 403);
  await ensureConversationColumns(env);
  if (!env.AI) return err("Workers AI binding required for vector reindex.", 501);

  const { results } = await env.DB.prepare("SELECT id, title, content, tags FROM knowledge_docs").all();
  let ok = 0;
  let fail = 0;
  for (const row of results || []) {
    const r = row as any;
    const text = `${r.title}\n${r.tags || ""}\n${r.content || ""}`.slice(0, 8000);
    const vector = await embedTextWithWorkersAI(env, text);
    if (!vector) {
      fail++;
      continue;
    }
    try {
      await env.DB.prepare("UPDATE knowledge_docs SET embedding = ? WHERE id = ?")
        .bind(JSON.stringify(vector), r.id)
        .run();
      ok++;
    } catch {
      fail++;
    }
  }
  adminLog("info", "knowledge", "reindex", { ok, fail, by: user.username });
  return json({ ok: true, embedded: ok, failed: fail });
}

/**
 * GET /api/tools/health — lightweight status for OCR / bg-remove / TTS / chat tools.
 * Used by the Tools UI to show a note when a feature isn't configured (501-class).
 */
async function handleToolsHealth(request: Request, env: Env): Promise<Response> {
  // Auth optional for a coarse status, but prefer signed-in users
  const user = await getUserFromRequest(env, request);
  const ocr = {
    ok: !!env.MISTRAL_API_KEY,
    detail: env.MISTRAL_API_KEY
      ? "OCR uses Mistral Document AI on this Worker."
      : "MISTRAL_API_KEY is not set — OCR will return 501.",
  };
  const bgRemove = {
    ok: !!(env.IMAGES && typeof env.IMAGES.input === "function"),
    detail:
      env.IMAGES && typeof env.IMAGES.input === "function"
        ? "Background removal uses Cloudflare Images (segment=foreground)."
        : "IMAGES binding missing — deploy with [images] binding = \"IMAGES\".",
  };
  const tts = {
    ok: !!(env.AI || env.ELEVENLABS_API_KEY || (env.CLOUDFLARE_AI_TOKEN && env.CLOUDFLARE_ACCOUNT_ID)),
    detail: env.AI
      ? "TTS can use the AI binding (elevenlabs/eleven-multilingual-v2)."
      : env.ELEVENLABS_API_KEY
        ? "TTS can use your ElevenLabs API key."
        : "No AI binding or ElevenLabs key — high-quality voice may fall back to device.",
  };
  const agentTools = {
    ok: !!(env.MISTRAL_API_KEY && env.MISTRAL_AGENT_ID),
    detail: "Time, weather, translate, and stock tools run on the Worker when the agent calls them.",
  };
  return json({
    authenticated: !!user,
    ocr,
    bg_remove: bgRemove,
    tts,
    agent_tools: agentTools,
  });
}

/**
 * POST /api/bg-remove  multipart form field "file"
 * Server-side background removal via Cloudflare Images binding
 * (segment=foreground / BiRefNet). No large model download in the browser.
 */
async function handleBgRemove(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  if (!env.IMAGES || typeof env.IMAGES.input !== "function") {
    return err("Background removal is not configured on this deployment (Images binding missing).", 501);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("Expected multipart form data with a file.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) return err("Missing file.", 400);
  if (file.size > 15 * 1024 * 1024) return err("Image is too large (max 15 MB).", 400);

  const mime = (file.type || "").toLowerCase();
  if (mime && !mime.startsWith("image/")) return err("File must be an image.", 400);

  try {
    const buf = await file.arrayBuffer();
    // Cloudflare Images: segment=foreground isolates the subject (BiRefNet).
    // Docs: https://developers.cloudflare.com/images/transform-images/transform-via-workers/
    const out = await env.IMAGES.input(buf)
      .transform({ segment: "foreground" })
      .output({ format: "image/png" });
    const imageResp: Response =
      typeof out.response === "function" ? await out.response() : (out as unknown as Response);
    if (!(imageResp instanceof Response) || !imageResp.ok) {
      const detail =
        imageResp instanceof Response
          ? (await imageResp.text().catch(() => "")).slice(0, 200)
          : "non-Response";
      console.log("BG-REMOVE: Images API failed", detail);
      return err("Background removal failed.", 502);
    }
    const bytes = await imageResp.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.log("BG-REMOVE exception", e?.message || e);
    return err("Background removal failed: " + (e?.message || "Unknown error"), 500);
  }
}

/**
 * POST /api/ocr  multipart form field "file"
 * Uses Mistral Document AI (mistral-ocr-latest) with the same MISTRAL_API_KEY as chat.
 * Returns { markdown: string }.
 */
async function handleOcr(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (!env.MISTRAL_API_KEY) return err("OCR is not configured on this deployment.", 501);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("Expected multipart form data with a file.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) && !(file instanceof Blob)) {
    return err("Missing file.", 400);
  }
  const blob = file as Blob;
  if (blob.size > 20 * 1024 * 1024) return err("File is too large (max 20 MB).", 400);

  const mime = (blob.type || "application/octet-stream").toLowerCase();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const dataUrl = `data:${mime};base64,${b64}`;

  const isPdf =
    mime.includes("pdf") ||
    (typeof (file as File).name === "string" && (file as File).name.toLowerCase().endsWith(".pdf"));

  const document = isPdf
    ? { type: "document_url", document_url: dataUrl }
    : { type: "image_url", image_url: dataUrl };

  try {
    const resp = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document,
      }),
    });

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 400);
      console.log("OCR: Mistral failed", resp.status, detail);
      return err(`OCR failed (${resp.status}).`, resp.status === 401 ? 502 : 502);
    }

    const data: any = await resp.json().catch(() => null);
    // Response shape: { pages: [{ markdown, ... }], ... } or similar
    let markdown = "";
    if (typeof data?.markdown === "string") {
      markdown = data.markdown;
    } else if (Array.isArray(data?.pages)) {
      markdown = data.pages
        .map((p: any) => (typeof p?.markdown === "string" ? p.markdown : typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n\n");
    } else if (typeof data?.text === "string") {
      markdown = data.text;
    }

    if (!markdown.trim()) {
      return json({ markdown: "", warning: "No text found in this file." });
    }
    return json({ markdown });
  } catch (e: any) {
    console.log("OCR exception", e?.message || e);
    return err("OCR request failed.", 500);
  }
}

async function handleListConversations(request: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  await ensureConversationColumns(env);

  const { results: owned } = await env.DB.prepare(
    `SELECT id, title, starred, archived, visibility, collab_locked, created_at, updated_at,
            0 AS is_collab_member, 1 AS is_owner
     FROM conversations WHERE user_id = ?
     ORDER BY starred DESC, updated_at DESC`
  )
    .bind(user.id)
    .all();

  // Conversations this user joined via collab invite or DM membership
  let joined: any[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.title, c.starred, c.archived, c.visibility, c.collab_locked, c.dm_peer_id, c.created_at, c.updated_at,
              CASE WHEN c.visibility = 'collab' THEN 1 ELSE 0 END AS is_collab_member,
              CASE WHEN c.visibility = 'dm' THEN 1 ELSE 0 END AS is_dm,
              0 AS is_owner
       FROM conversation_members m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.user_id = ? AND c.user_id != ?
       ORDER BY c.updated_at DESC`
    )
      .bind(user.id, user.id)
      .all();
    joined = results || [];
  } catch {
    joined = [];
  }

  const seen = new Set((owned || []).map((c: any) => c.id));
  const conversations = [...(owned || [])].map((c: any) => ({
    ...c,
    is_dm: c.visibility === "dm" ? 1 : 0,
    is_owner: 1,
  }));
  for (const c of joined) {
    if (!seen.has(c.id)) conversations.push(c);
  }

  // Unread counts: messages from others after this user's last_read_at
  // (soft-deleted messages excluded once column exists).
  const unreadMap = new Map<string, number>();
  try {
    const ids = conversations.map((c: any) => c.id);
    if (ids.length) {
      // Batch read cursors
      const placeholders = ids.map(() => "?").join(",");
      const { results: reads } = await env.DB.prepare(
        `SELECT conversation_id, last_read_at FROM conversation_reads
         WHERE user_id = ? AND conversation_id IN (${placeholders})`
      )
        .bind(user.id, ...ids)
        .all<{ conversation_id: string; last_read_at: string }>();
      const readAt = new Map((reads || []).map((r) => [r.conversation_id, r.last_read_at]));

      for (const c of conversations as any[]) {
        const since = readAt.get(c.id) || "1970-01-01T00:00:00.000Z";
        try {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM messages
             WHERE conversation_id = ?
               AND created_at > ?
               AND (sender_user_id IS NULL OR sender_user_id != ?)
               AND (deleted_at IS NULL)`
          )
            .bind(c.id, since, user.id)
            .first<{ n: number }>();
          unreadMap.set(c.id, row?.n || 0);
        } catch {
          // deleted_at column may be missing on very old DBs
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM messages
             WHERE conversation_id = ?
               AND created_at > ?
               AND (sender_user_id IS NULL OR sender_user_id != ?)`
          )
            .bind(c.id, since, user.id)
            .first<{ n: number }>();
          unreadMap.set(c.id, row?.n || 0);
        }
      }
    }
  } catch {
    /* ignore unread failures */
  }

  const withUnread = conversations.map((c: any) => ({
    ...c,
    unread_count: unreadMap.get(c.id) || 0,
  }));

  return json({ conversations: withUnread });
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
    "ALTER TABLE conversations ADD COLUMN collab_code TEXT",
    "ALTER TABLE conversations ADD COLUMN collab_code_used INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE conversations ADD COLUMN collab_locked INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN sender_user_id TEXT",
    `CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    )`,
    "ALTER TABLE conversations ADD COLUMN dm_peer_id TEXT",
    "ALTER TABLE messages ADD COLUMN reply_to_id TEXT",
    "ALTER TABLE messages ADD COLUMN reply_to_preview TEXT",
    `CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    )`,
    "ALTER TABLE users ADD COLUMN last_seen_at TEXT",
    `CREATE TABLE IF NOT EXISTS conversation_reads (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_read_at TEXT NOT NULL,
      last_message_id TEXT,
      PRIMARY KEY (conversation_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS collab_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      actor_user_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_a, user_b)
    )`,
    "ALTER TABLE messages ADD COLUMN edited_at TEXT",
    "ALTER TABLE messages ADD COLUMN deleted_at TEXT",
    "ALTER TABLE knowledge_docs ADD COLUMN embedding TEXT",
    "ALTER TABLE users ADD COLUMN banned_at TEXT",
    `CREATE TABLE IF NOT EXISTS admin_staff (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // Column / table already exists — nothing to do.
    }
  }
  conversationColumnsReady = true;
}

function generateCollabCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
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
  await ensureConversationColumns(env);

  const convo = await env.DB.prepare(
    "SELECT id, user_id, title, visibility, collab_locked, collab_code, collab_code_used FROM conversations WHERE id = ?"
  )
    .bind(id)
    .first<{ id: string; user_id: string; title: string; visibility: string; collab_locked: number; collab_code: string | null; collab_code_used: number }>();

  if (!convo) return err("Conversation not found.", 404);
  const isOwner = convo.user_id === user.id;
  const isShared = convo.visibility === "shared" || convo.visibility === "collab";
  const isDm = convo.visibility === "dm";

  let isMember = false;
  if (!isOwner && (convo.visibility === "collab" || isDm)) {
    const mem = await env.DB.prepare(
      "SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    )
      .bind(id, user.id)
      .first();
    isMember = !!mem;
  }

  if (!isOwner && !isShared && !(isDm && isMember)) {
    return err("Access forbidden. Ask the owner to share a link with access.", 403);
  }
  // Collab: must have joined with the code (members) unless still only viewing shared link without write
  if (!isOwner && convo.visibility === "collab" && !isMember) {
    // Allow read once shared, but can_write only after join
  }

  let results: any[] = [];
  try {
    const q = await env.DB.prepare(
      `SELECT m.id, m.role, m.content, m.attachments, m.created_at, m.sender_user_id,
              m.reply_to_id, m.reply_to_preview, m.edited_at, m.deleted_at,
              u.username AS sender_username, u.display_name AS sender_display_name,
              u.email AS sender_email, u.avatar AS sender_avatar
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_user_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`
    )
      .bind(id)
      .all();
    results = q.results || [];
  } catch {
    try {
      const q = await env.DB.prepare(
        `SELECT m.id, m.role, m.content, m.attachments, m.created_at, m.sender_user_id,
                m.reply_to_id, m.reply_to_preview,
                u.username AS sender_username, u.display_name AS sender_display_name,
                u.email AS sender_email, u.avatar AS sender_avatar
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_user_id
         WHERE m.conversation_id = ?
         ORDER BY m.created_at ASC`
      )
        .bind(id)
        .all();
      results = q.results || [];
    } catch {
      const q = await env.DB.prepare(
        "SELECT id, role, content, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
      )
        .bind(id)
        .all();
      results = q.results || [];
    }
  }

  const messages = results.map((m: any) => {
    const deleted = !!m.deleted_at;
    return {
      id: m.id,
      role: m.role,
      content: deleted ? "" : m.content,
      attachments: deleted ? [] : m.attachments ? JSON.parse(m.attachments) : [],
      created_at: m.created_at,
      edited_at: m.edited_at || null,
      deleted_at: m.deleted_at || null,
      reply_to_id: m.reply_to_id || null,
      reply_to_preview: m.reply_to_preview || null,
      sender:
        m.role === "agent"
          ? { id: "paul", username: "Paul", display_name: "Paul", email: null, avatar: null, is_paul: true }
          : m.sender_user_id
            ? {
                id: m.sender_user_id,
                username: m.sender_username || "user",
                display_name: m.sender_display_name || m.sender_username || "user",
                email: m.sender_email || null,
                avatar: m.sender_avatar || null,
                is_paul: false,
              }
            : null,
    };
  });

  let members: Awaited<ReturnType<typeof listCollabMembers>> = [];
  if (convo.visibility === "collab") {
    members = await listCollabMembers(env, id, convo.user_id);
  }

  // For DMs: resolve the other person so the UI can show username + user id (not a chat title/link).
  let dm_peer: {
    id: string;
    username: string;
    display_name: string;
    avatar: string | null;
  } | null = null;
  if (isDm) {
    try {
      const peerId =
        (convo as any).dm_peer_id && (convo as any).dm_peer_id !== user.id
          ? (convo as any).dm_peer_id
          : null;
      let resolvedId = peerId as string | null;
      if (!resolvedId) {
        const other = await env.DB.prepare(
          "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1"
        )
          .bind(id, user.id)
          .first<{ user_id: string }>();
        resolvedId = other?.user_id || null;
      }
      if (!resolvedId && (convo as any).user_id !== user.id) {
        resolvedId = (convo as any).user_id;
      }
      if (resolvedId) {
        const peer = await env.DB.prepare(
          "SELECT id, username, display_name, avatar FROM users WHERE id = ?"
        )
          .bind(resolvedId)
          .first<{ id: string; username: string; display_name: string | null; avatar: string | null }>();
        if (peer) {
          dm_peer = {
            id: peer.id,
            username: peer.username,
            display_name: peer.display_name || peer.username,
            avatar: peer.avatar,
          };
        }
      }
    } catch {
      dm_peer = null;
    }
  }

  // Presence + read receipts
  await touchPresence(env, user.id);
  const lastMsgId = messages.length ? messages[messages.length - 1].id : null;
  await markConversationRead(env, id, user.id, lastMsgId);
  let peer_read: { last_read_at: string; last_message_id: string | null } | null = null;
  let peer_last_seen: string | null = null;
  if (isDm && dm_peer?.id) {
    peer_read = await getPeerRead(env, id, dm_peer.id);
    try {
      const u = await env.DB.prepare("SELECT last_seen_at FROM users WHERE id = ?").bind(dm_peer.id).first<{ last_seen_at: string | null }>();
      peer_last_seen = u?.last_seen_at || null;
    } catch { peer_last_seen = null; }
  }

  return json({
    messages,
    conversation: {
      id: convo.id,
      title: convo.title,
      owner: isOwner,
      visibility: convo.visibility,
      collab_locked: !!convo.collab_locked,
      is_member: isOwner || isMember,
      can_write: isOwner || (convo.visibility === "collab" && isMember) || (isDm && isMember),
      collab_code: isOwner && convo.visibility === "collab" && !convo.collab_code_used ? convo.collab_code : null,
      collab_locked: !!convo.collab_locked,
      members,
      is_dm: isDm,
      dm_peer,
      peer_read,
      peer_last_seen,
    },
  });
}

async function handleSetConversationVisibility(request: Request, env: Env, id: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const convo = await env.DB.prepare(
    "SELECT id, visibility, collab_locked FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first<{ id: string; visibility: string; collab_locked: number }>();
  if (!convo) return err("Conversation not found.", 404);

  const body = (await request.json().catch(() => null)) as { visibility?: string } | null;
  const requested = body?.visibility;
  const visibility = requested === "shared" || requested === "collab" ? requested : "private";

  // Once a third party has posted in collab, it cannot go back to "only me"
  if (convo.collab_locked && visibility === "private") {
    return err("This chat stays collaborative — a participant already sent a message. It cannot be set to Only me.", 400);
  }

  let collab_code: string | null = null;
  if (visibility === "collab") {
    collab_code = generateCollabCode();
    await env.DB.prepare(
      "UPDATE conversations SET visibility = ?, collab_code = ?, collab_code_used = 0, updated_at = ? WHERE id = ?"
    )
      .bind(visibility, collab_code, nowIso(), id)
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE conversations SET visibility = ?, collab_code = NULL, collab_code_used = 0, updated_at = ? WHERE id = ?"
    )
      .bind(visibility, nowIso(), id)
      .run();
  }

  return json({ ok: true, visibility, collab_code });
}

/**
 * WebSocket live updates for a collab conversation.
 * Auth via Bearer cookie OR ?token= (browsers can't set Authorization on WS).
 * Each connection polls D1 and pushes snapshots when messages change.
 */
async function handleCollabLive(request: Request, env: Env, id: string): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return err("Expected WebSocket upgrade", 426);
  }

  const url = new URL(request.url);
  const user =
    (await getUserFromRequest(env, request)) ||
    (await getUserFromToken(env, url.searchParams.get("token")));
  if (!user) return err("Not authenticated.", 401);

  await ensureConversationColumns(env);
  const convo = await env.DB.prepare(
    "SELECT id, user_id, visibility FROM conversations WHERE id = ?"
  )
    .bind(id)
    .first<{ id: string; user_id: string; visibility: string }>();
  if (!convo) return err("Conversation not found.", 404);

  const isOwner = convo.user_id === user.id;
  const isShared = convo.visibility === "shared" || convo.visibility === "collab";
  let isMember = false;
  if (!isOwner && (convo.visibility === "collab" || convo.visibility === "dm")) {
    isMember = !!(await env.DB.prepare(
      "SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    )
      .bind(id, user.id)
      .first());
  }
  if (!isOwner && !isShared && !(convo.visibility === "dm" && isMember)) {
    return err("Access forbidden.", 403);
  }

    await touchPresence(env, user.id);

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  let lastFingerprint = "";
  let closed = false;

  const push = async () => {
    if (closed) return;
    try {
      // Reuse the same message assembly as GET /messages
      const fakeReq = new Request(request.url, {
        method: "GET",
        headers: request.headers,
      });
      // Build messages inline to avoid Response parsing overhead
      let results: any[] = [];
      try {
        const q = await env.DB.prepare(
          `SELECT m.id, m.role, m.content, m.attachments, m.created_at, m.sender_user_id,
                  m.reply_to_id, m.reply_to_preview,
                  u.username AS sender_username, u.display_name AS sender_display_name,
                  u.email AS sender_email, u.avatar AS sender_avatar
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_user_id
           WHERE m.conversation_id = ?
           ORDER BY m.created_at ASC`
        )
          .bind(id)
          .all();
        results = q.results || [];
      } catch {
        const q = await env.DB.prepare(
          "SELECT id, role, content, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
          .bind(id)
          .all();
        results = q.results || [];
      }

      const messages = results.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments ? JSON.parse(m.attachments) : [],
        created_at: m.created_at,
        reply_to_id: m.reply_to_id || null,
        reply_to_preview: m.reply_to_preview || null,
        sender:
          m.role === "agent"
            ? { id: "paul", username: "Paul", display_name: "Paul", email: null, avatar: null, is_paul: true }
            : m.sender_user_id
              ? {
                  id: m.sender_user_id,
                  username: m.sender_username || "user",
                  display_name: m.sender_display_name || m.sender_username || "user",
                  email: m.sender_email || null,
                  avatar: m.sender_avatar || null,
                  is_paul: false,
                }
              : null,
      }));

      const fingerprint = messages.map((m: any) => m.id).join(",");
      if (fingerprint === lastFingerprint) return;
      lastFingerprint = fingerprint;

      const mem = isOwner
        ? true
        : !!(await env.DB.prepare(
            "SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
          )
            .bind(id, user.id)
            .first());

      const full = await env.DB.prepare(
        "SELECT visibility, collab_locked FROM conversations WHERE id = ?"
      )
        .bind(id)
        .first<{ visibility: string; collab_locked: number }>();

      let typing: { user_id: string; username: string }[] = [];
      try {
        const since = new Date(Date.now() - 4000).toISOString();
        const tq = await env.DB.prepare(
          "SELECT user_id, username FROM typing_state WHERE conversation_id = ? AND updated_at > ? AND user_id != ?"
        )
          .bind(id, since, user.id)
          .all();
        typing = (tq.results || []).map((r: any) => ({
          user_id: r.user_id,
          username: r.username,
        }));
      } catch {
        typing = [];
      }

      server.send(
        JSON.stringify({
          type: "messages",
          messages,
          typing,
          conversation: {
            id,
            owner: isOwner,
            visibility: full?.visibility || convo.visibility,
            collab_locked: !!full?.collab_locked,
            is_member: isOwner || mem,
            can_write: isOwner || (full?.visibility === "collab" && mem),
          },
        })
      );
    } catch {
      /* ignore transient DB errors */
    }
  };

  server.addEventListener("close", () => {
    closed = true;
  });
  server.addEventListener("error", () => {
    closed = true;
  });
  server.addEventListener("message", (ev) => {
    const raw = String(ev.data || "");
    if (raw === "refresh") {
      void push();
      return;
    }
    // Typing indicator: persist briefly so other live clients see it on next push
    try {
      const data = JSON.parse(raw);
      if (data?.type === "typing" && user.username) {
        void (async () => {
          try {
            await env.DB.prepare(
              `CREATE TABLE IF NOT EXISTS typing_state (
                conversation_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (conversation_id, user_id)
              )`
            ).run();
            await env.DB.prepare(
              "INSERT OR REPLACE INTO typing_state (conversation_id, user_id, username, updated_at) VALUES (?, ?, ?, ?)"
            )
              .bind(id, user.id, user.display_name || user.username, nowIso())
              .run();
          } catch {
            /* ignore */
          }
        })();
      }
    } catch {
      /* ignore non-json */
    }
  });

  // Initial snapshot + interval push
  void push();
  const interval = setInterval(() => {
    if (closed) {
      clearInterval(interval);
      return;
    }
    void push();
  }, 1500);

  return new Response(null, { status: 101, webSocket: client });
}



async function touchPresence(env: Env, userId: string): Promise<void> {
  try {
    await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(nowIso(), userId).run();
  } catch { /* column may not exist */ }
}

async function markConversationRead(env: Env, conversationId: string, userId: string, lastMessageId?: string | null): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at, last_message_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at, last_message_id = excluded.last_message_id`
    )
      .bind(conversationId, userId, nowIso(), lastMessageId || null)
      .run();
  } catch { /* ignore */ }
}

async function getPeerRead(env: Env, conversationId: string, peerId: string): Promise<{ last_read_at: string; last_message_id: string | null } | null> {
  try {
    return await env.DB.prepare(
      "SELECT last_read_at, last_message_id FROM conversation_reads WHERE conversation_id = ? AND user_id = ?"
    )
      .bind(conversationId, peerId)
      .first<{ last_read_at: string; last_message_id: string | null }>();
  } catch {
    return null;
  }
}

async function writeAudit(
  env: Env,
  conversationId: string,
  actor: { id?: string; username?: string } | null,
  action: string,
  detail?: string
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO collab_audit (id, conversation_id, actor_user_id, actor_username, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(crypto.randomUUID(), conversationId, actor?.id || null, actor?.username || null, action, detail || null, nowIso())
      .run();
  } catch { /* ignore */ }
}

async function ensureKnowledgeSeed(env: Env): Promise<void> {
  try {
    const n = await env.DB.prepare("SELECT COUNT(*) AS c FROM knowledge_docs").first<{ c: number }>();
    if ((n?.c || 0) > 0) return;
    const docs = [
      {
        id: "marble-types",
        title: "Marble types & finishes",
        content:
          "AFM Arbre works with natural marble and engineered stone. Popular choices: Carrara (soft grey veins), Calacatta (bold veins), Emperador, Nero Marquina. Finishes: polished (glossy), honed (matte), brushed. Sealing recommended for kitchen/bath.",
        tags: "marble stone finish kitchen",
      },
      {
        id: "quote-process",
        title: "How to get a quote",
        content:
          "To get a quote: share dimensions (length x depth x thickness), room type (kitchen, bathroom, floor), preferred stone/color, and a photo if possible. Use the Get a quote form in Paul or ask @paul. Lead times vary by stock and fabrication.",
        tags: "quote price order lead",
      },
      {
        id: "care",
        title: "Marble care",
        content:
          "Clean with pH-neutral stone cleaner. Avoid acid (vinegar, lemon) and bleach. Wipe spills quickly. Reseal periodically. Use trivets and coasters.",
        tags: "care clean maintenance seal",
      },
    ];
    const ts = nowIso();
    for (const d of docs) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO knowledge_docs (id, title, content, tags, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(d.id, d.title, d.content, d.tags, ts)
        .run();
    }
  } catch { /* ignore */ }
}

/** Workers AI embedding model — bge-base-en-v1.5 (768-d). Falls back to small if needed. */
const EMBED_MODELS = ["@cf/baai/bge-base-en-v1.5", "@cf/baai/bge-small-en-v1.5"] as const;

async function embedTextWithWorkersAI(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI || !text.trim()) return null;
  const input = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  for (const model of EMBED_MODELS) {
    try {
      const result: any = await env.AI.run(model, { text: [input] });
      // Workers AI returns { data: number[][] } or { shape, data }
      const data = result?.data ?? result;
      if (Array.isArray(data) && Array.isArray(data[0])) return data[0] as number[];
      if (Array.isArray(data) && typeof data[0] === "number") return data as number[];
    } catch (e) {
      adminLog("warn", "embed", `model ${model} failed`, { err: String((e as any)?.message || e).slice(0, 200) });
    }
  }
  return null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * v10.1 vector RAG over knowledge_docs:
 * 1) Embed the query with Workers AI
 * 2) Rank docs by cosine similarity against stored embeddings
 * 3) Fall back to keyword scoring when AI/embeddings unavailable
 */
async function retrieveKnowledge(env: Env, query: string): Promise<{ snippets: string; sources: string[] }> {
  await ensureKnowledgeSeed(env);
  await ensureConversationColumns(env);
  const q = (query || "").trim();
  if (!q) return { snippets: "", sources: [] };

  try {
    const all = await env.DB.prepare(
      "SELECT id, title, content, tags, embedding FROM knowledge_docs"
    ).all();
    const rows = (all.results || []) as any[];
    if (!rows.length) return { snippets: "", sources: [] };

    const scored: { title: string; content: string; score: number }[] = [];

    // --- Vector path ---
    const queryVec = await embedTextWithWorkersAI(env, q);
    if (queryVec) {
      for (const r of rows) {
        let emb: number[] | null = null;
        if (r.embedding) {
          try {
            emb = JSON.parse(r.embedding);
          } catch {
            emb = null;
          }
        }
        if (emb && Array.isArray(emb) && emb.length === queryVec.length) {
          const sim = cosineSimilarity(queryVec, emb);
          // Mild keyword boost so exact product names still rank high
          const hay = `${r.title} ${r.tags || ""} ${r.content}`.toLowerCase();
          const words = q
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 2);
          let kw = 0;
          for (const w of words) if (hay.includes(w)) kw += 0.05;
          scored.push({ title: r.title, content: r.content, score: sim + kw });
        }
      }
    }

    // --- Keyword fallback if vector scored nothing ---
    if (!scored.length) {
      const words = q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 10);
      if (!words.length) return { snippets: "", sources: [] };
      for (const r of rows) {
        const hay = `${r.title} ${r.tags || ""} ${r.content}`.toLowerCase();
        let score = 0;
        for (const w of words) if (hay.includes(w)) score += 1;
        if (score > 0) scored.push({ title: r.title, content: r.content, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    // Keep docs above a weak similarity floor when using vectors
    const filtered = queryVec
      ? scored.filter((s) => s.score >= 0.25).slice(0, 4)
      : scored.slice(0, 3);
    const top = filtered.length ? filtered : scored.slice(0, 3);
    if (!top.length) return { snippets: "", sources: [] };

    const snippets = top
      .map((s, i) => `[Source ${i + 1}: ${s.title}]\n${String(s.content).slice(0, 2500)}`)
      .join("\n\n");
    return { snippets, sources: top.map((s) => s.title) };
  } catch {
    return { snippets: "", sources: [] };
  }
}

// ---------------------------------------------------------------------------
// Soft edit / delete own messages (v9.8)
// ---------------------------------------------------------------------------

async function handleEditMessage(request: Request, env: Env, messageId: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  const content = (body?.content ?? "").trim();
  if (!content) return err("Content is required.", 400);
  if (content.length > 20_000) return err("Message is too long.", 400);

  const msg = await env.DB.prepare(
    "SELECT id, conversation_id, role, sender_user_id, deleted_at FROM messages WHERE id = ?"
  )
    .bind(messageId)
    .first<{ id: string; conversation_id: string; role: string; sender_user_id: string | null; deleted_at: string | null }>();
  if (!msg) return err("Message not found.", 404);
  if (msg.deleted_at) return err("Message was deleted.", 410);
  if (msg.role !== "user" || msg.sender_user_id !== user.id) {
    return err("You can only edit your own messages.", 403);
  }

  const ts = nowIso();
  try {
    await env.DB.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?")
      .bind(content, ts, messageId)
      .run();
  } catch {
    return err("Could not edit message (schema).", 500);
  }

  // Soft-delete consecutive agent replies so a refresh doesn't resurrect the old answer
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, role FROM messages
       WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`
    )
      .bind(msg.conversation_id)
      .all();
    let hit = false;
    for (const r of (results || []) as any[]) {
      if (r.id === messageId) {
        hit = true;
        continue;
      }
      if (!hit) continue;
      if (r.role === "agent" || r.role === "error") {
        try {
          await env.DB.prepare(
            "UPDATE messages SET deleted_at = ?, content = '', attachments = NULL WHERE id = ?"
          )
            .bind(ts, r.id)
            .run();
        } catch {
          await env.DB.prepare("UPDATE messages SET deleted_at = ?, content = '' WHERE id = ?")
            .bind(ts, r.id)
            .run();
        }
      } else break;
    }
  } catch {
    /* best-effort */
  }

  await env.DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .bind(ts, msg.conversation_id)
    .run();
  return json({ ok: true, id: messageId, content, edited_at: ts });
}

async function handleDeleteMessage(request: Request, env: Env, messageId: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const msg = await env.DB.prepare(
    "SELECT id, conversation_id, role, sender_user_id, deleted_at FROM messages WHERE id = ?"
  )
    .bind(messageId)
    .first<{ id: string; conversation_id: string; role: string; sender_user_id: string | null; deleted_at: string | null }>();
  if (!msg) return err("Message not found.", 404);
  if (msg.deleted_at) return json({ ok: true, id: messageId, deleted: true });
  if (msg.role !== "user" || msg.sender_user_id !== user.id) {
    return err("You can only delete your own messages.", 403);
  }

  const ts = nowIso();
  try {
    await env.DB.prepare("UPDATE messages SET deleted_at = ?, content = '', attachments = NULL WHERE id = ?")
      .bind(ts, messageId)
      .run();
  } catch {
    try {
      await env.DB.prepare("UPDATE messages SET deleted_at = ?, content = '' WHERE id = ?")
        .bind(ts, messageId)
        .run();
    } catch {
      return err("Could not delete message (schema).", 500);
    }
  }

  // Soft-delete consecutive agent/error replies that followed this user message
  const cascadeIds: string[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, role, created_at FROM messages
       WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`
    )
      .bind(msg.conversation_id)
      .all();
    const list = results || [];
    let hit = false;
    for (const r of list as any[]) {
      if (r.id === messageId) {
        hit = true;
        continue;
      }
      if (!hit) continue;
      if (r.role === "agent" || r.role === "error") {
        cascadeIds.push(r.id);
      } else {
        break; // next user turn
      }
    }
    for (const cid of cascadeIds) {
      try {
        await env.DB.prepare(
          "UPDATE messages SET deleted_at = ?, content = '', attachments = NULL WHERE id = ?"
        )
          .bind(ts, cid)
          .run();
      } catch {
        await env.DB.prepare("UPDATE messages SET deleted_at = ?, content = '' WHERE id = ?")
          .bind(ts, cid)
          .run();
      }
    }
  } catch {
    /* cascade best-effort */
  }

  await env.DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .bind(ts, msg.conversation_id)
    .run();
  return json({ ok: true, id: messageId, deleted: true, deleted_at: ts, cascaded: cascadeIds });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

async function handleListBlocks(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  try {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar, b.created_at AS blocked_at
       FROM user_blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`
    )
      .bind(user.id)
      .all();
    return json({ blocked: results || [] });
  } catch {
    return json({ blocked: [] });
  }
}

async function handleBlockUser(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => null)) as { user_id?: string; username?: string } | null;
  let blockedId = String(body?.user_id || "").trim();
  if (!blockedId && body?.username) {
    const peer = await env.DB.prepare("SELECT id FROM users WHERE lower(username) = lower(?)")
      .bind(String(body.username).replace(/^@/, ""))
      .first<{ id: string }>();
    blockedId = peer?.id || "";
  }
  if (!blockedId) return err("User required.", 400);
  if (blockedId === user.id) return err("You can't block yourself.", 400);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
  )
    .bind(user.id, blockedId, nowIso())
    .run();
  // Drop friendship if any
  const [a, b] = friendshipPair(user.id, blockedId);
  try {
    await env.DB.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").bind(a, b).run();
  } catch { /* ignore */ }
  return json({ ok: true, blocked: true });
}

async function handleUnblockUser(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => null)) as { user_id?: string } | null;
  const blockedId = String(body?.user_id || "").trim();
  if (!blockedId) return err("User required.", 400);
  await env.DB.prepare("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?")
    .bind(user.id, blockedId)
    .run();
  return json({ ok: true, blocked: false });
}

async function isBlockedEither(env: Env, a: string, b: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT 1 AS ok FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1"
    )
      .bind(a, b, b, a)
      .first();
    return !!row;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Friends + DM chats
// ---------------------------------------------------------------------------

function friendshipPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function handleListFriends(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (user.is_guest) return json({ friends: [], pending_in: [], pending_out: [] });

  let rows: any[] = [];
  try {
    const q = await env.DB.prepare(
      `SELECT f.id, f.user_a, f.user_b, f.requester_id, f.status, f.created_at, f.updated_at,
              ua.username AS a_username, ua.display_name AS a_display_name, ua.avatar AS a_avatar,
              ub.username AS b_username, ub.display_name AS b_display_name, ub.avatar AS b_avatar
       FROM friendships f
       JOIN users ua ON ua.id = f.user_a
       JOIN users ub ON ub.id = f.user_b
       WHERE f.user_a = ? OR f.user_b = ?
       ORDER BY f.updated_at DESC`
    )
      .bind(user.id, user.id)
      .all();
    rows = q.results || [];
  } catch {
    rows = [];
  }

  const friends: any[] = [];
  const pending_in: any[] = [];
  const pending_out: any[] = [];

  for (const r of rows) {
    const peerIsA = r.user_b === user.id;
    const peer = {
      id: peerIsA ? r.user_a : r.user_b,
      username: peerIsA ? r.a_username : r.b_username,
      display_name: (peerIsA ? r.a_display_name : r.b_display_name) || (peerIsA ? r.a_username : r.b_username),
      avatar: peerIsA ? r.a_avatar : r.b_avatar,
    };
    const item = { id: r.id, status: r.status, peer, created_at: r.created_at, updated_at: r.updated_at };
    if (r.status === "accepted") friends.push(item);
    else if (r.status === "pending") {
      if (r.requester_id === user.id) pending_out.push(item);
      else pending_in.push(item);
    }
  }

  return json({ friends, pending_in, pending_out });
}

async function handleFriendRequest(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (user.is_guest) return err("Save your account before adding friends.", 400);

  const body = (await request.json().catch(() => null)) as { username?: string } | null;
  const username = String(body?.username || "").trim().replace(/^@/, "");
  if (!username || username.length < 2) return err("Enter a username.", 400);

  const peer = await env.DB.prepare(
    "SELECT id, username, display_name, avatar, is_guest FROM users WHERE lower(username) = lower(?)"
  )
    .bind(username)
    .first<{ id: string; username: string; display_name: string | null; avatar: string | null; is_guest: number }>();
  if (!peer) return err("User not found.", 404);
  if (peer.id === user.id) return err("You can't add yourself.", 400);
  if (await isBlockedEither(env, user.id, peer.id)) {
    return err("You can't add this user.", 403);
  }
  if (peer.is_guest) return err("That account is a guest — they need to save it first.", 400);

  const [user_a, user_b] = friendshipPair(user.id, peer.id);
  const existing = await env.DB.prepare(
    "SELECT id, status, requester_id FROM friendships WHERE user_a = ? AND user_b = ?"
  )
    .bind(user_a, user_b)
    .first<{ id: string; status: string; requester_id: string }>();

  if (existing?.status === "accepted") return err("You're already friends.", 409);
  if (existing?.status === "pending") {
    if (existing.requester_id === user.id) return err("Friend request already sent.", 409);
    // They already requested us — auto-accept
    await env.DB.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
      .bind(nowIso(), existing.id)
      .run();
    return json({ ok: true, status: "accepted", friendship_id: existing.id });
  }

  const id = crypto.randomUUID();
  const ts = nowIso();
  await env.DB.prepare(
    "INSERT INTO friendships (id, user_a, user_b, requester_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
  )
    .bind(id, user_a, user_b, user.id, ts, ts)
    .run();

  return json({ ok: true, status: "pending", friendship_id: id });
}

async function handleFriendRespond(request: Request, env: Env, friendshipId: string, action: "accept" | "reject"): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const row = await env.DB.prepare(
    "SELECT id, user_a, user_b, requester_id, status FROM friendships WHERE id = ?"
  )
    .bind(friendshipId)
    .first<{ id: string; user_a: string; user_b: string; requester_id: string; status: string }>();
  if (!row) return err("Request not found.", 404);
  if (row.user_a !== user.id && row.user_b !== user.id) return err("Access forbidden.", 403);

  if (action === "accept") {
    if (row.status === "accepted") return json({ ok: true, status: "accepted" });
    if (row.requester_id === user.id) return err("You sent this request — wait for them to accept.", 400);
    await env.DB.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?")
      .bind(nowIso(), row.id)
      .run();
    return json({ ok: true, status: "accepted" });
  }

  // reject / cancel / unfriend
  await env.DB.prepare("DELETE FROM friendships WHERE id = ?").bind(row.id).run();
  return json({ ok: true, status: "removed" });
}

/** Open DM by username (accepted friends only) — powers `#user=username` links. */
async function handleOpenDmByUsername(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const body = (await request.json().catch(() => null)) as { username?: string } | null;
  const username = String(body?.username || "").trim().replace(/^@/, "");
  if (!username) return err("Username required.", 400);

  const peer = await env.DB.prepare(
    "SELECT id, username, display_name, avatar FROM users WHERE lower(username) = lower(?)"
  )
    .bind(username)
    .first<{ id: string; username: string; display_name: string | null; avatar: string | null }>();
  if (!peer) return err("User not found.", 404);
  if (peer.id === user.id) return err("That's you.", 400);

  const [user_a, user_b] = friendshipPair(user.id, peer.id);
  const fr = await env.DB.prepare(
    "SELECT id, status FROM friendships WHERE user_a = ? AND user_b = ?"
  )
    .bind(user_a, user_b)
    .first<{ id: string; status: string }>();
  if (!fr || fr.status !== "accepted") {
    return err("You're not friends with this user yet.", 403);
  }
  // Reuse the friendship-id open path
  return handleOpenDm(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
    }),
    env,
    fr.id
  );
}

/** Live friend-request stream (WebSocket). Pushes snapshot every ~2s. */
async function handleFriendsLive(request: Request, env: Env): Promise<Response> {
  await ensureConversationColumns(env);
  if (request.headers.get("Upgrade") !== "websocket") {
    return err("Expected WebSocket upgrade.", 426);
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || undefined;
  // Auth via cookie or ?token=
  let user = await getUserFromRequest(env, request);
  if (!user && token) {
    try {
      const row = await env.DB.prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?"
      )
        .bind(token, nowIso())
        .first();
      if (row) user = row as any;
    } catch {
      /* ignore */
    }
  }
  if (!user) return err("Not authenticated.", 401);

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  let closed = false;

  const push = async () => {
    if (closed) return;
    try {
      // Reuse list logic inline (lightweight)
      const q = await env.DB.prepare(
        `SELECT f.id, f.user_a, f.user_b, f.requester_id, f.status, f.created_at, f.updated_at,
                ua.username AS a_username, ua.display_name AS a_display_name, ua.avatar AS a_avatar,
                ub.username AS b_username, ub.display_name AS b_display_name, ub.avatar AS b_avatar
         FROM friendships f
         JOIN users ua ON ua.id = f.user_a
         JOIN users ub ON ub.id = f.user_b
         WHERE f.user_a = ? OR f.user_b = ?
         ORDER BY f.updated_at DESC`
      )
        .bind(user!.id, user!.id)
        .all();
      const friends: any[] = [];
      const pending_in: any[] = [];
      const pending_out: any[] = [];
      for (const r of q.results || []) {
        const row = r as any;
        const peerIsA = row.user_b === user!.id;
        const peer = {
          id: peerIsA ? row.user_a : row.user_b,
          username: peerIsA ? row.a_username : row.b_username,
          display_name:
            (peerIsA ? row.a_display_name : row.b_display_name) ||
            (peerIsA ? row.a_username : row.b_username),
          avatar: peerIsA ? row.a_avatar : row.b_avatar,
        };
        const item = {
          id: row.id,
          status: row.status,
          peer,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
        if (row.status === "accepted") friends.push(item);
        else if (row.status === "pending") {
          if (row.requester_id === user!.id) pending_out.push(item);
          else pending_in.push(item);
        }
      }
      server.send(
        JSON.stringify({
          type: "friends",
          friends,
          pending_in,
          pending_out,
        })
      );
    } catch {
      /* ignore transient */
    }
  };

  server.addEventListener("close", () => {
    closed = true;
  });
  server.addEventListener("error", () => {
    closed = true;
  });
  server.addEventListener("message", (ev) => {
    if (String(ev.data) === "refresh") void push();
  });

  void push();
  const interval = setInterval(() => {
    if (closed) {
      clearInterval(interval);
      return;
    }
    void push();
  }, 2000);

  return new Response(null, { status: 101, webSocket: client });
}

/** Open or create a DM conversation with an accepted friend. */
async function handleOpenDm(request: Request, env: Env, friendshipId: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);

  const row = await env.DB.prepare(
    "SELECT id, user_a, user_b, status FROM friendships WHERE id = ?"
  )
    .bind(friendshipId)
    .first<{ id: string; user_a: string; user_b: string; status: string }>();
  if (!row || row.status !== "accepted") return err("You're not friends with this user.", 403);
  if (row.user_a !== user.id && row.user_b !== user.id) return err("Access forbidden.", 403);

  const peerId = row.user_a === user.id ? row.user_b : row.user_a;
  const peer = await env.DB.prepare(
    "SELECT id, username, display_name, avatar FROM users WHERE id = ?"
  )
    .bind(peerId)
    .first<{ id: string; username: string; display_name: string | null; avatar: string | null }>();
  if (!peer) return err("User not found.", 404);

  // Find existing DM between these two
  let existing: { id: string; title: string } | null = null;
  try {
    existing = await env.DB.prepare(
      `SELECT c.id, c.title FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
       WHERE c.visibility = 'dm'
       LIMIT 1`
    )
      .bind(user.id, peerId)
      .first<{ id: string; title: string }>();
  } catch {
    existing = null;
  }

  if (existing) {
    return json({
      conversation_id: existing.id,
      title: existing.title,
      peer: {
        id: peer.id,
        username: peer.username,
        display_name: peer.display_name || peer.username,
        avatar: peer.avatar,
      },
    });
  }

  const id = crypto.randomUUID();
  const ts = nowIso();
  const title = peer.display_name || peer.username;
  await env.DB.prepare(
    `INSERT INTO conversations (id, user_id, mistral_conversation_id, title, visibility, dm_peer_id, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'dm', ?, ?, ?)`
  )
    .bind(id, user.id, title, peerId, ts, ts)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)"
  )
    .bind(id, user.id, ts)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)"
  )
    .bind(id, peerId, ts)
    .run();

  return json({
    conversation_id: id,
    title,
    peer: {
      id: peer.id,
      username: peer.username,
      display_name: peer.display_name || peer.username,
      avatar: peer.avatar,
    },
  });
}

/** POST /api/conversations/:id/join  { code: "1234" } — accept collab invite */
async function handleJoinCollab(request: Request, env: Env, id: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  if (user.is_guest) return err("Save your account before joining a collaboration.", 400);

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = String(body?.code || "").trim();
  if (!/^\d{4}$/.test(code)) return err("Enter the 4-digit confirmation code.", 400);

  const convo = await env.DB.prepare(
    "SELECT id, user_id, visibility, collab_code, collab_code_used, title FROM conversations WHERE id = ?"
  )
    .bind(id)
    .first<{
      id: string;
      user_id: string;
      visibility: string;
      collab_code: string | null;
      collab_code_used: number;
      title: string;
    }>();

  if (!convo) return err("Conversation not found.", 404);
  if (convo.user_id === user.id) {
    return json({ ok: true, already_owner: true, conversation_id: id });
  }
  if (convo.visibility !== "collab") return err("This chat is not open for collaboration.", 400);
  if (!convo.collab_code || convo.collab_code !== code) return err("Invalid confirmation code.", 403);
  if (convo.collab_code_used) return err("This invite code was already used. Ask the owner for a new share.", 410);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)"
  )
    .bind(id, user.id, nowIso())
    .run();
  // Single-use code — regenerate next time owner shares
  await env.DB.prepare("UPDATE conversations SET collab_code_used = 1, collab_code = NULL, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();

  adminLog("info", "collab", "member joined", { conversation_id: id, user_id: user.id });
  await writeAudit(env, id, { id: user.id, username: user.username }, "member_joined", user.username);
  return json({ ok: true, conversation_id: id, title: convo.title });
}

interface ChatRequestBody {
  conversation_id?: string;
  message: string;
  attachments?: AttachmentIn[];
  reply_to_id?: string;
  reply_to_preview?: string;
}

/** Extract unique @handles from text (lowercase, no @). Supports many in one message. */
function parseMentionHandles(text: string): string[] {
  const found = new Set<string>();
  const re = /(^|[^\w])@([a-zA-Z][\w.-]{0,31})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ""))) {
    found.add(m[2].toLowerCase());
  }
  return [...found];
}

/** Remove every @handle token, collapse leftover whitespace. */
function stripMentionHandles(text: string): string {
  return (text || "")
    .replace(/(^|[^\w])@([a-zA-Z][\w.-]{0,31})\b/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function listCollabMembers(
  env: Env,
  conversationId: string,
  ownerId: string
): Promise<{ id: string; username: string; display_name: string; avatar: string | null; is_owner: boolean }[]> {
  const members: { id: string; username: string; display_name: string; avatar: string | null; is_owner: boolean }[] = [];
  // Owner first
  try {
    const owner = await env.DB.prepare(
      "SELECT id, username, display_name, avatar FROM users WHERE id = ?"
    )
      .bind(ownerId)
      .first<{ id: string; username: string; display_name: string | null; avatar: string | null }>();
    if (owner) {
      members.push({
        id: owner.id,
        username: owner.username,
        display_name: owner.display_name || owner.username,
        avatar: owner.avatar,
        is_owner: true,
      });
    }
  } catch {
    /* ignore */
  }
  try {
    const q = await env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ? AND m.user_id != ?
       ORDER BY m.joined_at ASC`
    )
      .bind(conversationId, ownerId)
      .all();
    for (const row of q.results || []) {
      const r = row as any;
      members.push({
        id: r.id,
        username: r.username,
        display_name: r.display_name || r.username,
        avatar: r.avatar || null,
        is_owner: false,
      });
    }
  } catch {
    /* table may not exist */
  }
  return members;
}


async function handleGetAudit(request: Request, env: Env, id: string): Promise<Response> {
  await ensureConversationColumns(env);
  const user = await getUserFromRequest(env, request);
  if (!user) return err("Not authenticated.", 401);
  const convo = await env.DB.prepare("SELECT id, user_id, visibility FROM conversations WHERE id = ?")
    .bind(id)
    .first<{ id: string; user_id: string; visibility: string }>();
  if (!convo) return err("Not found.", 404);
  if (convo.user_id !== user.id) {
    const mem = await env.DB.prepare(
      "SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    )
      .bind(id, user.id)
      .first();
    if (!mem) return err("Access forbidden.", 403);
  }
  let events: any[] = [];
  try {
    const q = await env.DB.prepare(
      "SELECT id, actor_user_id, actor_username, action, detail, created_at FROM collab_audit WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 100"
    )
      .bind(id)
      .all();
    events = q.results || [];
  } catch {
    events = [];
  }
  return json({ events });
}

async function handleChat(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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
    convo = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?")
      .bind(body.conversation_id)
      .first<ConversationRow>();
    if (!convo) return err("Conversation not found.", 404);
    // Non-owners: collab members or DM peers may post
    if (convo.user_id !== user.id) {
      await ensureConversationColumns(env);
      const mem = await env.DB.prepare(
        "SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      )
        .bind(convo.id, user.id)
        .first();
      if (convo.visibility === "dm") {
        if (!mem) return err("Access forbidden.", 403);
      } else if (convo.visibility === "collab") {
        if (!mem) {
          return err("Join this collaboration with the 4-digit code before sending messages.", 403);
        }
      } else {
        return err("Access forbidden. Ask the owner to share this chat for collaboration.", 403);
      }
    }
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
  const attMeta = attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size, dataUrl: a.dataUrl }));
  const replyToId = body.reply_to_id ? String(body.reply_to_id).slice(0, 64) : null;
  const replyToPreview = body.reply_to_preview ? String(body.reply_to_preview).slice(0, 200) : null;
  await ensureConversationColumns(env);
  try {
    await env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at, sender_user_id, reply_to_id, reply_to_preview) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        userMsgId,
        convo.id,
        body.message || "",
        attMeta.length ? JSON.stringify(attMeta) : null,
        nowIso(),
        user.id,
        replyToId,
        replyToPreview
      )
      .run();
  } catch {
    try {
      await env.DB.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at, sender_user_id) VALUES (?, ?, 'user', ?, ?, ?, ?)"
      )
        .bind(userMsgId, convo.id, body.message || "", attMeta.length ? JSON.stringify(attMeta) : null, nowIso(), user.id)
        .run();
    } catch {
      await env.DB.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, 'user', ?, ?, ?)"
      )
        .bind(userMsgId, convo.id, body.message || "", attMeta.length ? JSON.stringify(attMeta) : null, nowIso())
        .run();
    }
  }

  // Clear typing indicator for this sender
  try {
    await env.DB.prepare("DELETE FROM typing_state WHERE conversation_id = ? AND user_id = ?")
      .bind(convo.id, user.id)
      .run();
  } catch { /* table may not exist */ }

  // @all in collab — log audit notification
  if ((convo as any).visibility === "collab" && /(^|[^\w])@all\b/i.test(body.message || "")) {
    await writeAudit(env, convo.id, { id: user.id, username: user.username }, "at_all", (body.message || "").slice(0, 120));
  }

  // Third-party message locks collab → cannot return to "Only me"
  if (convo.user_id !== user.id && convo.visibility === "collab") {
    try {
      await env.DB.prepare("UPDATE conversations SET collab_locked = 1, updated_at = ? WHERE id = ?")
        .bind(nowIso(), convo.id)
        .run();
    } catch {
      /* column may not exist yet on very old DBs */
    }
  }

  // Collab + friend DM: Paul only replies when @paul is among the mentions.
  // Plain messages stay human-to-human. (Private 1:1 with Paul always answers.)
  const vis = String((convo as any).visibility || "private");
  const needsPaulTag = vis === "collab" || vis === "dm";
  let knowledgeSources: string[] = [];
  const mentionHandles = parseMentionHandles(body.message || "");
  const mentionsPaul = mentionHandles.some((h) => h === "paul");
  if (needsPaulTag && !mentionsPaul) {
    await env.DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .bind(nowIso(), convo.id)
      .run();
    return json({
      conversation_id: convo.id,
      title: convo.title,
      reply: null,
      attachments: [],
      paul_skipped: true,
      mentions: mentionHandles,
    });
  }

  // Cross-chat memory: hand Paul what he knows about the user on every turn.
  // Injecting only on the first turn meant a question asked later in the same
  // chat ("who am I?") had no memory in context at all.
  const useMemory = memoryEnabled(user);
  const memoryRows = useMemory ? await listMemoryRows(env, user.id) : [];
  // Strip ALL @handles from what Paul sees so tags don't pollute the prompt
  // (keeps multi-mention messages readable: "@paul @alice what's the quote?")
  const cleanMessage = stripMentionHandles(body.message || "");
  // Lightweight RAG over marble knowledge
  const rag = await retrieveKnowledge(env, cleanMessage || body.message || "");
  const ragPreamble = rag.snippets
    ? `\n\n[Business knowledge — cite these when relevant]\n${rag.snippets}\n\n`
    : "";
  const outgoingMessage = buildMemoryPreamble(memoryRows) + ragPreamble + (cleanMessage || body.message || "");
  knowledgeSources = rag.sources;

  try {
    const result = await callMistral({
      apiKey: env.MISTRAL_API_KEY,
      agentId: env.MISTRAL_AGENT_ID,
      mistralConversationId: convo.mistral_conversation_id,
      message: outgoingMessage,
      attachments,
    });

    // Learn from this exchange in the background so the reply isn't held up.
    if (useMemory && (body.message || "").trim().length > 12) {
      const learn = (async () => {
        try {
          const existing = (await listMemoryRows(env, user.id)).map((r) => ({ title: r.title, content: r.content }));
          const items = await extractMemories(env.MISTRAL_API_KEY, {
            userMessage: body.message || "",
            reply: result.reply || "",
            existing,
          });
          for (const item of items) await upsertMemory(env, user.id, item, "chat");
        } catch (e) {
          console.log("memory: extraction skipped", e);
          adminLog("warn", "memory", "extraction skipped", e);
        }
      })();
      if (ctx?.waitUntil) ctx.waitUntil(learn);
    }

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

    let replyText = result.reply || "";
    if (knowledgeSources && knowledgeSources.length && replyText && !/\(empty response\)/.test(replyText)) {
      // Append citations if the model didn't already
      if (!/sources?:/i.test(replyText) && !/\[Source/i.test(replyText)) {
        replyText += "\n\nSources: " + knowledgeSources.join("; ");
      }
    }
    return json({
      conversation_id: convo.id,
      title: newTitle,
      reply: replyText,
      attachments: agentAttachments,
      sources: knowledgeSources || [],
    });
  } catch (e: any) {
    const errorMsgId = crypto.randomUUID();
    const message = e?.message || "Something went wrong talking to the model.";
    adminLog("error", "chat", message, { conversation_id: convo.id });
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
  /** Quote dimensions (cm or free text units). */
  length?: string;
  width?: string;
  thickness?: string;
  room_type?: string;
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
  const dims: string[] = [];
  if (body.length?.trim()) dims.push(`L: ${body.length.trim()}`);
  if (body.width?.trim()) dims.push(`W: ${body.width.trim()}`);
  if (body.thickness?.trim()) dims.push(`T: ${body.thickness.trim()}`);
  if (body.room_type?.trim()) dims.push(`Room: ${body.room_type.trim()}`);
  const dimLine = dims.length ? `[Dimensions] ${dims.join(" · ")}\n` : "";
  const message = `${dimLine}${body.message?.trim() || ""}`.trim().slice(0, 4000) || null;
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
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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
        resp = await handleGuestLogin(request, env);
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
      } else if (path === "/api/sessions/logout-all" && request.method === "POST") {
        // Wipe every session for this user (all devices)
        resp = await handleLogoutAllSessions(request, env);
      } else if (path.match(/^\/api\/sessions\/[^/]+$/) && request.method === "DELETE") {
        // Revoke a specific session by its token prefix
        resp = await handleRevokeSession(request, env, path.split("/").pop()!);
      } else if (path === "/api/user/delete" && request.method === "DELETE") {
        // Soft-delete: 7-day grace period, then hard purge
        resp = await handleDeleteAccount(request, env);
      } else if (path === "/api/user/cancel-deletion" && request.method === "POST") {
        resp = await handleCancelDeletion(request, env);
      } else if (path === "/api/memory" && request.method === "GET") {
        // Paul's cross-chat memory: list entries + the on/off switch
        resp = await handleListMemory(request, env);
      } else if (path === "/api/memory" && request.method === "POST") {
        resp = await handleCreateMemory(request, env);
      } else if (path === "/api/memory/settings" && request.method === "PATCH") {
        resp = await handleMemorySettings(request, env);
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleDeleteMemory(request, env, path.split("/").pop()!);
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && request.method === "PATCH") {
        resp = await handleUpdateMemory(request, env, path.split("/").pop()!);
      } else if (path === "/api/memory/revise" && request.method === "POST") {
        // Natural-language revise / delete of one memory entry
        resp = await handleReviseMemory(request, env);
      } else if (path === "/api/memory/generate" && request.method === "POST") {
        // Re-read recent chats and store structured memory entries
        resp = await handleGenerateMemory(request, env);
      } else if (path === "/api/tts" && request.method === "POST") {
        // Studio text-to-speech, proxied so the key stays server-side
        resp = await handleTts(request, env);
      } else if (path === "/api/ocr" && request.method === "POST") {
        // Tools → OCR via Mistral Document AI (same API key as chat)
        resp = await handleOcr(request, env);
      } else if (path === "/api/bg-remove" && request.method === "POST") {
        // Tools → background removal via Cloudflare Images (no client model download)
        resp = await handleBgRemove(request, env);
      } else if (path === "/api/tools/health" && request.method === "GET") {
        resp = await handleToolsHealth(request, env);
      } else if (path === "/api/admin/logs" && request.method === "GET") {
        resp = await handleAdminLogsGet(request, env);
      } else if (path === "/api/admin/logs" && request.method === "DELETE") {
        resp = await handleAdminLogsClear(request, env);
      } else if (path === "/api/admin/users" && request.method === "GET") {
        resp = await handleAdminUsers(request, env);
      } else if (path.match(/^\/api\/admin\/users\/[^/]+\/export$/) && request.method === "GET") {
        resp = await handleAdminUserExport(request, env, path.split("/")[4]);
      } else if (path.match(/^\/api\/admin\/users\/[^/]+$/) && request.method === "GET") {
        resp = await handleAdminUserDetail(request, env, path.split("/")[4]);
      } else if (path.match(/^\/api\/admin\/users\/[^/]+\/ban$/) && request.method === "POST") {
        resp = await handleAdminBanUser(request, env, path.split("/")[4]);
      } else if (path.match(/^\/api\/admin\/users\/[^/]+\/password$/) && request.method === "POST") {
        resp = await handleAdminSetPassword(request, env, path.split("/")[4]);
      } else if (path.match(/^\/api\/admin\/users\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleAdminDeleteUser(request, env, path.split("/")[4]);
      } else if (path === "/api/staff" && request.method === "GET") {
        resp = await handleListStaff(request, env);
      } else if (path === "/api/staff" && request.method === "POST") {
        resp = await handleAssignStaff(request, env);
      } else if (path.match(/^\/api\/staff\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleRemoveStaff(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/call$/) && request.method === "GET") {
        return handleCallLive(request, env, path.split("/")[3]);
      } else if (path === "/api/presence/live" && request.method === "GET") {
        return handlePresenceLive(request, env);
      } else if (path === "/api/presence" && request.method === "GET") {
        resp = await handlePresenceSnapshot(request, env);
      } else if (path === "/api/usage/quota" && request.method === "GET") {
        resp = await handleUsageQuota(request, env);
      } else if (path === "/api/knowledge" && request.method === "GET") {
        resp = await handleListKnowledge(request, env);
      } else if (path === "/api/knowledge" && request.method === "POST") {
        resp = await handleUpsertKnowledge(request, env);
      } else if (path === "/api/knowledge/reindex" && request.method === "POST") {
        resp = await handleReindexKnowledge(request, env);
      } else if (path.match(/^\/api\/knowledge\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleDeleteKnowledge(request, env, path.split("/")[3]);
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
      } else if (path.match(/^\/api\/conversations\/[^/]+\/join$/) && request.method === "POST") {
        resp = await handleJoinCollab(request, env, path.split("/")[3]);
      } else if (path === "/api/blocks" && request.method === "GET") {
        resp = await handleListBlocks(request, env);
      } else if (path === "/api/block" && request.method === "POST") {
        resp = await handleBlockUser(request, env);
      } else if (path === "/api/block" && request.method === "DELETE") {
        resp = await handleUnblockUser(request, env);
      } else if (path === "/api/friends" && request.method === "GET") {
        resp = await handleListFriends(request, env);
      } else if (path === "/api/friends/request" && request.method === "POST") {
        resp = await handleFriendRequest(request, env);
      } else if (path === "/api/friends/dm" && request.method === "POST") {
        resp = await handleOpenDmByUsername(request, env);
      } else if (path === "/api/friends/live" && request.method === "GET") {
        return handleFriendsLive(request, env);
      } else if (path.match(/^\/api\/friends\/[^/]+\/accept$/) && request.method === "POST") {
        resp = await handleFriendRespond(request, env, path.split("/")[3], "accept");
      } else if (path.match(/^\/api\/friends\/[^/]+\/reject$/) && request.method === "POST") {
        resp = await handleFriendRespond(request, env, path.split("/")[3], "reject");
      } else if (path.match(/^\/api\/friends\/[^/]+\/dm$/) && request.method === "POST") {
        resp = await handleOpenDm(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/friends\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleFriendRespond(request, env, path.split("/")[3], "reject");
      } else if (path.match(/^\/api\/conversations\/[^/]+\/files$/) && request.method === "GET") {
        resp = await handleGetConversationFiles(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/usage$/) && request.method === "GET") {
        resp = await handleGetConversationUsage(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/messages$/) && request.method === "GET") {
        resp = await handleGetMessages(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/live$/) && request.method === "GET") {
        // WebSocket live feed for collab chats (token via ?token= for cross-origin WS)
        return handleCollabLive(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/conversations\/[^/]+\/audit$/) && request.method === "GET") {
        resp = await handleGetAudit(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/messages\/[^/]+$/) && request.method === "PATCH") {
        resp = await handleEditMessage(request, env, path.split("/")[3]);
      } else if (path.match(/^\/api\/messages\/[^/]+$/) && request.method === "DELETE") {
        resp = await handleDeleteMessage(request, env, path.split("/")[3]);
      } else if (path === "/api/chat" && request.method === "POST") {
        resp = await handleChat(request, env, ctx);
      } else if (path === "/api/leads" && request.method === "POST") {
        resp = await handleCreateLead(request, env);
      } else {
        resp = json({ error: "Not found" }, { status: 404 });
      }
    } catch (e: any) {
      adminLog("error", "worker", e?.message || "Unknown server error", { path });
      resp = json({ error: e?.message || "Unknown server error" }, { status: 500 });
    }

    return withCors(resp, request, env);
  },
};
