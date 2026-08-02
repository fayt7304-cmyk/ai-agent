import type { Env } from "./types";

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "*";
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : null;
  const allowOrigin = allowed ? (allowed.includes(origin) ? origin : allowed[0]) : origin;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function withCors(resp: Response, request: Request, env: Env): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data as any, init);
}
