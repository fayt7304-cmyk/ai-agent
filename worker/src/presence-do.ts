/**
 * PresenceHub — Durable Object for real-time online presence (v10.2).
 *
 * One global hub (id "global") tracks which users are online via WebSocket.
 * Clients connect to /api/presence/live; the Worker forwards the upgrade to this DO.
 */

export interface PresenceEnv {
  // Minimal env surface — DO only needs itself
}

type ClientMeta = { userId: string; username: string };

export class PresenceHub {
  private state: DurableObjectState;
  private sessions = new Map<WebSocket, ClientMeta>();
  private online = new Map<string, { username: string; since: string; sockets: number }>();

  constructor(state: DurableObjectState, _env: PresenceEnv) {
    this.state = state;
    // Restore hibernated sockets if any
    try {
      const existing = this.state.getWebSockets?.() || [];
      for (const ws of existing) {
        const meta = (ws as any).deserializeAttachment?.() as ClientMeta | null;
        if (meta?.userId) {
          this.sessions.set(ws, meta);
          this.bumpOnline(meta, 1);
        }
      }
    } catch {
      /* older runtime without hibernation helpers */
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // HTTP snapshot of who is online
    if (request.method === "GET" && url.pathname.endsWith("/snapshot")) {
      return Response.json({
        online: [...this.online.entries()].map(([id, v]) => ({
          user_id: id,
          username: v.username,
          since: v.since,
        })),
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const userId = url.searchParams.get("userId") || "";
    const username = url.searchParams.get("username") || "user";
    if (!userId) return new Response("userId required", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Prefer hibernation API when available
    try {
      this.state.acceptWebSocket(server);
      (server as any).serializeAttachment?.({ userId, username } satisfies ClientMeta);
    } catch {
      server.accept();
    }

    this.sessions.set(server, { userId, username });
    this.bumpOnline({ userId, username }, 1);
    this.broadcast();

    server.addEventListener("message", (ev) => {
      const raw = String((ev as MessageEvent).data || "");
      if (raw === "ping") {
        try {
          server.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
        } catch {
          /* ignore */
        }
        return;
      }
      if (raw === "who") {
        try {
          server.send(this.snapshotJson());
        } catch {
          /* ignore */
        }
      }
    });

    server.addEventListener("close", () => this.detach(server));
    server.addEventListener("error", () => this.detach(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation handlers
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === "string" ? message : "";
    if (raw === "ping") {
      try {
        ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
      } catch {
        /* ignore */
      }
    } else if (raw === "who") {
      try {
        ws.send(this.snapshotJson());
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.detach(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.detach(ws);
  }

  private detach(ws: WebSocket) {
    const meta = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (meta) {
      this.bumpOnline(meta, -1);
      this.broadcast();
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  private bumpOnline(meta: ClientMeta, delta: number) {
    const cur = this.online.get(meta.userId);
    if (!cur) {
      if (delta > 0) {
        this.online.set(meta.userId, {
          username: meta.username,
          since: new Date().toISOString(),
          sockets: 1,
        });
      }
      return;
    }
    cur.sockets += delta;
    cur.username = meta.username || cur.username;
    if (cur.sockets <= 0) this.online.delete(meta.userId);
  }

  private snapshotJson(): string {
    return JSON.stringify({
      type: "presence",
      online: [...this.online.entries()].map(([id, v]) => ({
        user_id: id,
        username: v.username,
        since: v.since,
      })),
    });
  }

  private broadcast() {
    const payload = this.snapshotJson();
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(payload);
      } catch {
        /* ignore broken sockets */
      }
    }
  }
}
