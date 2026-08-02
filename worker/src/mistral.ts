import type { AttachmentIn } from "./types";

export interface MistralCallOptions {
  apiKey: string;
  agentId: string;
  mistralConversationId?: string | null;
  message: string;
  attachments?: AttachmentIn[];
}

export interface MistralCallResult {
  reply: string;
  mistralConversationId: string;
  attachments: AttachmentIn[];
}

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// Cloudflare Workers has no Buffer — build the base64 string in chunks so we
// don't blow the call stack passing a huge byte array to String.fromCharCode at once.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// The image_generation tool returns a `tool_file` chunk with a file_id — the actual
// image bytes have to be fetched separately from Mistral's Files API, then we inline
// them as a data URL so the frontend can render (and later re-load) the image with no
// extra plumbing on our side.
async function downloadToolFile(apiKey: string, fileId: string, fileName: string, fileType: string): Promise<AttachmentIn | null> {
  // Generated images occasionally fail to download on the first try (transient network
  // blip / the file not being fully ready on Mistral's side yet) — one retry with a short
  // delay turns most of those into a normal success instead of a silently missing image.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`https://api.mistral.ai/v1/files/${fileId}/content`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) {
        lastErr = new Error(`file download failed (${resp.status})`);
      } else {
        const buf = await resp.arrayBuffer();
        const ext = (fileType || "png").toLowerCase();
        const mime = EXT_MIME[ext] || "image/png";
        return {
          name: `${fileName || "image"}.${ext}`,
          mime,
          size: buf.byteLength,
          dataUrl: `data:${mime};base64,${arrayBufferToBase64(buf)}`,
        };
      }
    } catch (e) {
      lastErr = e;
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  console.error("downloadToolFile failed after retry", fileId, lastErr);
  return null;
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

  const payload = isNew ? { agent_id: opts.agentId, inputs, stream: false } : { inputs, stream: false };

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
  // A turn can include more than one message.output entry (e.g. the model narrates,
  // calls a tool, then follows up) — collecting all of them instead of just the first
  // avoids silently dropping text or files that arrived after the first entry.
  const messageOutputs = outputs.filter((o) => o.type === "message.output");

  let reply = "";
  const attachments: AttachmentIn[] = [];
  let hadFileFailure = false;

  for (const messageOutput of messageOutputs) {
    if (typeof messageOutput.content === "string") {
      reply += messageOutput.content;
    } else if (Array.isArray(messageOutput.content)) {
      for (const chunk of messageOutput.content) {
        if (chunk.type === "tool_file" && chunk.file_id) {
          try {
            const file = await downloadToolFile(opts.apiKey, chunk.file_id, chunk.file_name, chunk.file_type);
            if (file) attachments.push(file);
            else hadFileFailure = true;
          } catch {
            // Still surface the text reply rather than erroring the whole turn.
            hadFileFailure = true;
          }
        } else if (typeof chunk?.text === "string") {
          reply += chunk.text;
        }
      }
    }
  }

  // Drop any leftover "![...](filename.png)" markdown the model wrote referring to a
  // generated file by its bare name — that's not a loadable URL, and the real image is
  // already attached above, so showing it as raw text would just look broken.
  reply = reply.replace(/!\[[^\]]*\]\((?!https?:|data:)[^)]*\)\s*/g, "").trim();

  if (hadFileFailure) {
    reply = reply
      ? `${reply}\n\n_(One of the generated files couldn't be downloaded — try again if it's missing.)_`
      : "I generated a file, but couldn't download it just now. Please try again.";
  }

  return { reply, mistralConversationId: data.conversation_id, attachments };
}
