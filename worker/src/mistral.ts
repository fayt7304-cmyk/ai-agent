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

/** Parse tool arguments that may arrive as a JSON string or object. */
function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

/** Short-lived in-memory cache for weather / stock (Worker isolate lifetime). */
const toolCache = new Map<string, { expires: number; value: string }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGet(key: string): string | null {
  const hit = toolCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    toolCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: string) {
  toolCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  // Soft cap so the isolate doesn't grow forever
  if (toolCache.size > 200) {
    const first = toolCache.keys().next().value;
    if (first) toolCache.delete(first);
  }
}

/**
 * Map agent tool names → category.
 * Covers common Mistral console names and loose keyword matches.
 */
type ToolKind = "time" | "weather" | "translate" | "stock" | "unknown";

function classifyTool(name: string): ToolKind {
  const raw = (name || "").trim();
  const n = raw.toLowerCase().replace(/[_\s-]+/g, "");

  // Exact / near-exact aliases from typical agent console configs
  const exact: Record<string, ToolKind> = {
    get_time: "time",
    gettime: "time",
    current_time: "time",
    currenttime: "time",
    get_current_time: "time",
    getcurrenttime: "time",
    datetime: "time",
    get_datetime: "time",
    get_date: "time",
    getdate: "time",
    clock: "time",
    now: "time",
    get_weather: "weather",
    getweather: "weather",
    weather: "weather",
    weather_lookup: "weather",
    weatherlookup: "weather",
    forecast: "weather",
    get_forecast: "weather",
    temperature: "weather",
    translate: "translate",
    translate_text: "translate",
    translatetext: "translate",
    translation: "translate",
    get_translation: "translate",
    get_stock: "stock",
    getstock: "stock",
    stock: "stock",
    stock_price: "stock",
    stockprice: "stock",
    get_stock_price: "stock",
    getstockprice: "stock",
    ticker: "stock",
    get_ticker: "stock",
    quote: "stock",
    get_quote: "stock",
    getquote: "stock",
    share_price: "stock",
  };
  if (exact[raw.toLowerCase()] || exact[n]) return exact[raw.toLowerCase()] || exact[n];

  if (n.includes("time") || n.includes("datetime") || n.includes("clock") || n.includes("currentdate")) return "time";
  if (n.includes("weather") || n.includes("forecast") || n.includes("temperature")) return "weather";
  if (n.includes("translate") || n.includes("translation")) return "translate";
  if (n.includes("stock") || n.includes("ticker") || n.includes("quote") || (n.includes("price") && !n.includes("stock"))) {
    // "price" alone is ambiguous; prefer stock when ticker-like args exist later
    if (n.includes("stock") || n.includes("ticker") || n.includes("quote") || n.includes("share")) return "stock";
  }
  if (n.includes("stock") || n.includes("ticker") || n.includes("shareprice") || n.includes("equity")) return "stock";
  return "unknown";
}

/**
 * Built-in tool runners for custom functions attached on the Mistral agent
 * (weather, time, translate, stocks).
 */
async function executeLocalTool(name: string, args: Record<string, unknown>): Promise<string> {
  const kind = classifyTool(name);

  // ---- Current time / date
  if (kind === "time") {
    const tz = String(args.timezone || args.tz || args.time_zone || "UTC");
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short",
      }).format(now);
      return JSON.stringify({
        iso: now.toISOString(),
        timezone: tz,
        formatted,
        unix: Math.floor(now.getTime() / 1000),
      });
    } catch {
      const now = new Date();
      return JSON.stringify({ iso: now.toISOString(), timezone: "UTC", formatted: now.toUTCString() });
    }
  }

  // ---- Weather (Open-Meteo, no key) — cached 5 min per location
  if (kind === "weather") {
    const location = String(args.location || args.city || args.place || args.query || "Paris").trim();
    const cacheKey = `weather:${location.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    try {
      const geoResp = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
      );
      const geo: any = await geoResp.json().catch(() => null);
      const hit = geo?.results?.[0];
      if (!hit) return JSON.stringify({ error: `Location not found: ${location}` });

      const lat = hit.latitude;
      const lon = hit.longitude;
      const weatherResp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
      );
      const weather: any = await weatherResp.json().catch(() => null);
      const cur = weather?.current || {};
      const codeMap: Record<number, string> = {
        0: "Clear",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        61: "Rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Snow",
        80: "Rain showers",
        95: "Thunderstorm",
      };
      const payload = JSON.stringify({
        location: hit.name,
        country: hit.country || hit.country_code,
        latitude: lat,
        longitude: lon,
        temperature_c: cur.temperature_2m,
        feels_like_c: cur.apparent_temperature,
        humidity_pct: cur.relative_humidity_2m,
        wind_kmh: cur.wind_speed_10m,
        condition: codeMap[cur.weather_code] || `code ${cur.weather_code}`,
        weather_code: cur.weather_code,
        observed_at: cur.time,
      });
      cacheSet(cacheKey, payload);
      return payload;
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || "Weather lookup failed" });
    }
  }

  // ---- Translate (LibreTranslate public instance)
  if (kind === "translate") {
    const text = String(args.text || args.query || args.content || "").trim();
    const source = String(args.source || args.from || args.source_language || "auto");
    const target = String(args.target || args.to || args.target_language || "en");
    if (!text) return JSON.stringify({ error: "No text to translate" });
    try {
      const resp = await fetch("https://libretranslate.com/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text.slice(0, 4000), source, target, format: "text" }),
      });
      const data: any = await resp.json().catch(() => null);
      if (!resp.ok) return JSON.stringify({ error: data?.error || `Translate failed (${resp.status})` });
      return JSON.stringify({
        translated: data?.translatedText || "",
        source,
        target,
        original: text.slice(0, 200),
      });
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || "Translation failed" });
    }
  }

  // ---- Stock pricing (Yahoo chart API) — cached 5 min per symbol
  if (kind === "stock" || (kind === "unknown" && (args.symbol || args.ticker))) {
    const symbol = String(args.symbol || args.ticker || args.query || args.name || "AAPL")
      .trim()
      .toUpperCase();
    const cacheKey = `stock:${symbol}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PaulBot/9.0)" },
      });
      const data: any = await resp.json().catch(() => null);
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return JSON.stringify({ error: `No quote for ${symbol}` });
      const payload = JSON.stringify({
        symbol: meta.symbol || symbol,
        price: meta.regularMarketPrice,
        currency: meta.currency,
        previous_close: meta.chartPreviousClose ?? meta.previousClose,
        exchange: meta.exchangeName || meta.fullExchangeName,
        market_state: meta.marketState,
        as_of: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : undefined,
      });
      cacheSet(cacheKey, payload);
      return payload;
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || "Stock quote failed" });
    }
  }

  // Unknown tool — clear stub so the model can still answer
  return JSON.stringify({
    error: `Tool "${name}" is not implemented on the server.`,
    received_args: args,
    hint: "Supported server tools: time, weather, translate, stock (aliases: get_time, get_weather, translate_text, get_stock_price, …).",
  });
}

function collectMessageContent(outputs: any[]): { reply: string; attachments: AttachmentIn[]; hadFileFailure: boolean } {
  let reply = "";
  const attachments: AttachmentIn[] = [];
  let hadFileFailure = false;
  const messageOutputs = outputs.filter((o) => o.type === "message.output");
  for (const messageOutput of messageOutputs) {
    if (typeof messageOutput.content === "string") {
      reply += messageOutput.content;
    } else if (Array.isArray(messageOutput.content)) {
      for (const chunk of messageOutput.content) {
        if (chunk.type === "tool_file" && chunk.file_id) {
          // filled later asynchronously — placeholder flag
          hadFileFailure = true; // will be corrected if download succeeds
        } else if (typeof chunk?.text === "string") {
          reply += chunk.text;
        }
      }
    }
  }
  return { reply, attachments, hadFileFailure };
}

export async function callMistral(opts: MistralCallOptions): Promise<MistralCallResult> {
  const isNew = !opts.mistralConversationId;
  let conversationId = opts.mistralConversationId || "";

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

  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
  };

  // First turn: start or append user message
  let endpoint = isNew
    ? "https://api.mistral.ai/v1/conversations"
    : `https://api.mistral.ai/v1/conversations/${conversationId}`;
  let payload: Record<string, unknown> = isNew
    ? { agent_id: opts.agentId, inputs, stream: false }
    : { inputs, stream: false };

  let data: any = null;
  const maxToolRounds = 6;

  for (let round = 0; round < maxToolRounds; round++) {
    let resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      // Stuck waiting for a previous tool result → start a fresh conversation
      if (
        round === 0 &&
        !isNew &&
        resp.status === 400 &&
        /function results are still missing/i.test(errText)
      ) {
        console.log("Mistral: stuck tool state — starting a fresh conversation");
        endpoint = "https://api.mistral.ai/v1/conversations";
        payload = { agent_id: opts.agentId, inputs, stream: false };
        resp = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const retryText = await resp.text();
          throw new Error(`Mistral API error (${resp.status}): ${retryText}`);
        }
      } else {
        throw new Error(`Mistral API error (${resp.status}): ${errText}`);
      }
    }

    data = await resp.json();
    conversationId = data.conversation_id || conversationId;
    const outputs: any[] = Array.isArray(data.outputs) ? data.outputs : [];

    // Agent asked for function results — run tools and feed them back
    const functionCalls = outputs.filter((o) => o.type === "function.call");
    if (functionCalls.length > 0) {
      const results: Array<{ type: string; tool_call_id: string; result: string }> = [];
      for (const call of functionCalls) {
        const toolCallId = call.tool_call_id || call.id;
        const toolName = call.name || call.function?.name || "unknown";
        const args = parseToolArgs(call.arguments ?? call.function?.arguments);
        console.log("Mistral tool call", toolName, toolCallId, JSON.stringify(args).slice(0, 200));
        const result = await executeLocalTool(toolName, args);
        results.push({
          type: "function.result",
          tool_call_id: toolCallId,
          result,
        });
      }
      endpoint = `https://api.mistral.ai/v1/conversations/${conversationId}`;
      payload = { inputs: results, stream: false };
      continue;
    }

    // Final assistant message
    let reply = "";
    const attachments: AttachmentIn[] = [];
    let hadFileFailure = false;

    for (const messageOutput of outputs.filter((o) => o.type === "message.output")) {
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
              hadFileFailure = true;
            }
          } else if (typeof chunk?.text === "string") {
            reply += chunk.text;
          }
        }
      }
    }

    reply = reply.replace(/!\[[^\]]*\]\((?!https?:|data:)[^)]*\)\s*/g, "").trim();

    if (hadFileFailure) {
      reply = reply
        ? `${reply}\n\n_(One of the generated files couldn't be downloaded — try again if it's missing.)_`
        : "I generated a file, but couldn't download it just now. Please try again.";
    }

    if (!reply && attachments.length === 0) {
      reply = "(empty response)";
    }

    return { reply, mistralConversationId: conversationId, attachments };
  }

  throw new Error("Mistral tool loop exceeded maximum rounds.");
}

// ---------------------------------------------------------------------------
// Memory extraction
//
// After a chat turn, pull out any durable facts worth remembering across chats
// (who the user is, what they prefer, ongoing projects). Deliberately uses the
// small chat-completions model rather than the agent: it's cheap, fast and never
// touches the user's conversation thread.
// ---------------------------------------------------------------------------
export interface MemoryItem {
  title: string;
  content: string;
}

export async function extractMemories(
  apiKey: string,
  opts: { userMessage: string; reply: string; existing: MemoryItem[] }
): Promise<MemoryItem[]> {
  const existing = opts.existing
    .map((m) => `- ${m.title}: ${m.content}`)
    .join("\n")
    .slice(0, 4000);

  const prompt = `You maintain a long-term memory about a user of an assistant app.
From the exchange below, extract ONLY durable facts worth remembering in future, separate conversations
(identity, role, location, language, preferences, ongoing projects, recurring interests).
Ignore one-off questions, small talk and anything time-bound.

Existing memory (update these titles instead of duplicating them):
${existing || "(empty)"}

User said:
${opts.userMessage.slice(0, 3000)}

Assistant replied:
${opts.reply.slice(0, 2000)}

Answer with JSON only: {"memories":[{"title":"Short topic (2-3 words)","content":"One or two sentences."}]}
Return {"memories":[]} when there is nothing durable to store. Never include more than 3 items.`;

  const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral-small-latest",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`memory extraction failed (${resp.status})`);

  const data: any = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((c: any) => c?.text || "").join("") : "";
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed?.memories) ? parsed.memories : [];
  return items
    .filter((m: any) => typeof m?.title === "string" && typeof m?.content === "string" && m.title.trim() && m.content.trim())
    .slice(0, 3)
    .map((m: any) => ({ title: m.title.trim().slice(0, 60), content: m.content.trim().slice(0, 600) }));
}
