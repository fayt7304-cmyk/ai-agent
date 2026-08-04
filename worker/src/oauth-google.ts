import type { Env } from "./types";

export function buildGoogleAuthUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForAccessToken(env: Env, code: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed: ${await resp.text()}`);
  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

export interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error("Failed to fetch Google user info");
  return resp.json();
}
