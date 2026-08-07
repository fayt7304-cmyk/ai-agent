/**
 * CallRoom — Durable Object for 1:1 WebRTC signaling (v10.3/10.4 fix).
 * One room per conversation id. Relays invite/offer/answer/ice/hangup between peers.
 */

type Peer = { userId: string; username: string };

export class CallRoom {
  private state: DurableObjectState;
  private peers = new Map<WebSocket, Peer>();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
    try {
      for (const ws of this.state.getWebSockets?.() || []) {
        const meta = (ws as any).deserializeAttachment?.() as Peer | null;
        if (meta?.userId) this.peers.set(ws, meta);
      }
    } catch {
      /* ignore */
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(
        JSON.stringify({ peers: [...this.peers.values()].map((p) => p.userId) }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "";
    const username = url.searchParams.get("username") || "user";
    if (!userId) return new Response("userId required", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Prefer hibernation API (required path on many CF runtimes)
    let hibernating = false;
    try {
      this.state.acceptWebSocket(server);
      (server as any).serializeAttachment?.({ userId, username } satisfies Peer);
      hibernating = true;
    } catch {
      server.accept();
    }

    this.peers.set(server, { userId, username });

    this.send(server, {
      type: "joined",
      peers: [...this.peers.values()].map((p) => ({ user_id: p.userId, username: p.username })),
    });
    this.broadcast(server, {
      type: "peer-joined",
      user_id: userId,
      username,
    });

    if (!hibernating) {
      server.addEventListener("message", (ev) => {
        this.onMessage(server, String((ev as MessageEvent).data || ""));
      });
      server.addEventListener("close", () => this.leave(server));
      server.addEventListener("error", () => this.leave(server));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    this.onMessage(ws, typeof message === "string" ? message : new TextDecoder().decode(message));
  }

  async webSocketClose(ws: WebSocket) {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private onMessage(ws: WebSocket, raw: string) {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const peer = this.peers.get(ws);
    if (!peer) return;

    const type = String(data.type || "");
    // Relay all signaling types to the other peer(s)
    if (
      [
        "hello",
        "invite",
        "offer",
        "answer",
        "ice",
        "hangup",
        "decline",
        "accept",
      ].includes(type)
    ) {
      this.broadcast(ws, {
        ...data,
        from: peer.userId,
        from_username: peer.username,
      });
    }
  }

  private leave(ws: WebSocket) {
    const peer = this.peers.get(ws);
    this.peers.delete(ws);
    if (peer) {
      this.broadcast(ws, { type: "peer-left", user_id: peer.userId, username: peer.username });
    }
    try {
      ws.close(1000, "left");
    } catch {
      /* ignore */
    }
  }

  private send(ws: WebSocket, obj: unknown) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }

  private broadcast(except: WebSocket, obj: unknown) {
    const payload = JSON.stringify(obj);
    for (const [ws] of this.peers) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
}
