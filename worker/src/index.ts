export interface Env {
  MISTRAL_API_KEY: string;
}

// ---- Customize your agent here ----------------------------------
const AGENT_MODEL = "mistral-medium-latest";
const AGENT_INSTRUCTIONS =
  "You are a helpful, friendly assistant. Answer clearly and concisely.";
// --------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(resp: Response): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}

interface ChatRequestBody {
  message: string;
  conversation_id?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        if (!env.MISTRAL_API_KEY) {
          return withCors(
            Response.json({ error: "MISTRAL_API_KEY is not configured on this Worker." }, { status: 500 })
          );
        }

        const body = (await request.json()) as ChatRequestBody;
        if (!body.message || typeof body.message !== "string") {
          return withCors(Response.json({ error: "Missing 'message'" }, { status: 400 }));
        }

        // No conversation yet -> start one with our model + instructions.
        // Existing conversation -> just append the new message to it.
        const isNewConversation = !body.conversation_id;
        const endpoint = isNewConversation
          ? "https://api.mistral.ai/v1/conversations"
          : `https://api.mistral.ai/v1/conversations/${body.conversation_id}`;

        const payload = isNewConversation
          ? {
              model: AGENT_MODEL,
              instructions: AGENT_INSTRUCTIONS,
              inputs: body.message,
              stream: false,
            }
          : {
              inputs: body.message,
              stream: false,
            };

        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return withCors(Response.json({ error: `Mistral API error: ${errText}` }, { status: 502 }));
        }

        const data: any = await resp.json();

        // Pull the assistant's text out of the outputs array.
        const outputs: any[] = Array.isArray(data.outputs) ? data.outputs : [];
        const messageOutput = outputs.find((o) => o.type === "message.output");
        const reply =
          typeof messageOutput?.content === "string"
            ? messageOutput.content
            : Array.isArray(messageOutput?.content)
              ? messageOutput.content.map((c: any) => c.text || "").join("")
              : "";

        return withCors(
          Response.json({
            reply,
            conversation_id: data.conversation_id,
          })
        );
      } catch (err: any) {
        return withCors(Response.json({ error: err?.message || "Unknown error" }, { status: 500 }));
      }
    }

    return withCors(new Response("Not found", { status: 404 }));
  },
};
