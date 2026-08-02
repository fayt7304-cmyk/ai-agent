import type { Env, UserRow } from "./types";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

export function randomToken(len = 32): string {
  const arr = randomBytes(len);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder();
  const salt = saltB64 ? new Uint8Array(base64ToBuf(saltB64)) : randomBytes(16);
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: bufToBase64(bits), salt: bufToBase64(salt.buffer) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const attempt = await hashPassword(password, salt);
  // constant-time-ish compare
  if (attempt.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= attempt.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// When COOKIE_DOMAIN is configured (e.g. ".yourdomain.com") the frontend and worker
// share a registrable domain, so the cookie is same-site and we can use the stricter,
// more widely-honoured SameSite=Lax. Mobile browsers (iOS Safari in particular) are
// increasingly aggressive about dropping SameSite=None cookies for a Worker domain
// (e.g. *.workers.dev) that the user never visits directly — that's the most common
// cause of "not authenticated" after login on a phone. Without COOKIE_DOMAIN we fall
// back to the old cross-site-cookie behavior so nothing breaks if it isn't set yet.
function domainAttr(domain?: string): string {
  return domain ? `; Domain=${domain}` : "";
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number, domain?: string): string {
  const sameSite = domain ? "Lax" : "None";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=${sameSite}${domainAttr(domain)}; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(domain?: string): string {
  const sameSite = domain ? "Lax" : "None";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=${sameSite}${domainAttr(domain)}; Max-Age=0`;
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function createSession(env: Env, userId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, now.toISOString(), expires.toISOString())
    .run();
  return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 };
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export async function getUserFromRequest(env: Env, request: Request): Promise<UserRow | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, new Date().toISOString())
    .first<UserRow>();
  return row || null;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const RESET_TOKEN_MINUTES = 60;

export async function createPasswordResetToken(env: Env, userId: string): Promise<string> {
  const raw = randomToken(32);
  const tokenHash = await sha256Hex(raw);
  const now = new Date();
  const expires = new Date(now.getTime() + RESET_TOKEN_MINUTES * 60 * 1000);
  await env.DB.prepare(
    "INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)"
  )
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString())
    .run();
  return raw;
}

export async function consumePasswordResetToken(env: Env, rawToken: string): Promise<string | null> {
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    "SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?"
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{ user_id: string }>();
  if (!row) return null;
  await env.DB.prepare("UPDATE password_reset_tokens SET used = 1 WHERE token_hash = ?").bind(tokenHash).run();
  return row.user_id;
}

export async function destroyAllSessionsForUser(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

const OAUTH_STATE_COOKIE = "oauth_state";

export function oauthStateCookieHeader(state: string): string {
  return `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearOauthStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readOauthState(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${OAUTH_STATE_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
