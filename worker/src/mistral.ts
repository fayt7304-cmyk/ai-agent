import type { AttachmentIn } from "./types";

export interface MistralCallOptions {
  apiKey: string;
  model: string;
  instructions: string;
  mistralConversationId?: string | null;
  message: string;
  attachments?: AttachmentIn[];
}

export interface MistralCallResult {
  reply: string;
  mistralConversationId: string;
}

export async function callMistral(opts: MistralCallOptions): Promise<MistralCallResult> {
  const isNew = !opts.mistralConversationId;
  const endpoint = isNew
    ? "https://api.mistral.ai/v1/conversations"
    : `https://api.mistral.ai/v1/conversations/${opts.mistralConversationId}`;

  let inputs: unknown;
  if (opts.attachments && opts.attachments.length > 0) {
    const parts: Record<string, unknown>[] = [{ type: "text", text: opts.message || " " }];
    for (const att of opts.attachments) {
      if (att.mime.startsWith("image/")) {
        parts.push({ type: "image_url", image_url: att.dataUrl });
      } else {
        parts.push({ type: "document_url", document_url: att.dataUrl });
      }
    }
    inputs = [{ role: "user", content: parts }];
  } else {
    inputs = opts.message;
  }

  const payload = isNew
    ? { model: opts.model, instructions: opts.instructions, inputs, stream: false }
    : { inputs, stream: false };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Mistral API error (${resp.status}): ${errText}`);
  }

  const data: any = await resp.json();
  const outputs: any[] = Array.isArray(data.outputs) ? data.outputs : [];
  const messageOutput = outputs.find((o) => o.type === "message.output");
  const reply =
    typeof messageOutput?.content === "string"
      ? messageOutput.content
      : Array.isArray(messageOutput?.content)
        ? messageOutput.content.map((c: any) => c.text || "").join("")
        : "";

  return { reply, mistralConversationId: data.conversation_id };
}
