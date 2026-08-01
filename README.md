# Mistral Agent Chat

A minimal chat web app powered by a Mistral AI agent — a Cloudflare
Worker backend (keeps your API key private) + a small chat UI
frontend.

Under the hood this uses Mistral's **Conversations API**
(`/v1/conversations`) with a `model` + `instructions` pair — the same
mechanism behind the "Agents" you can create in Mistral's console
(the screenshot you shared). You don't need to pre-create an Agent in
the console; the Worker defines the agent's personality/instructions
in code, which is easier to iterate on and version-control.

---

## 1. Get a Mistral API key

Sign up at https://console.mistral.ai/, then create a key under
**API keys**.

## 2. Deploy the Worker (backend)

```
npm install -g wrangler
wrangler login
cd worker
wrangler secret put MISTRAL_API_KEY
wrangler deploy
```

Wrangler will print a URL like:
```
https://mistral-agent-chat.YOUR-SUBDOMAIN.workers.dev
```

## 3. Customize your agent

Open `worker/src/index.ts` and edit these two constants:

```ts
const AGENT_MODEL = "mistral-medium-latest";
const AGENT_INSTRUCTIONS = "You are a helpful, friendly assistant. Answer clearly and concisely.";
```

`AGENT_INSTRUCTIONS` is the system prompt — this is where you define
what your agent is (a study buddy, a coding helper, a customer
support bot, whatever you want). Redeploy with `wrangler deploy`
after changing it.

Other models you can use: `mistral-large-latest`, `mistral-small-latest`,
`magistral-medium-latest` (reasoning), `codestral-latest` (code).

## 4. Point the frontend at your Worker

Open `app/src/main.ts` and replace the placeholder URL:

```ts
export const CHAT_ENDPOINT = "https://mistral-agent-chat.YOUR-SUBDOMAIN.workers.dev/api/chat";
```

## 5. Run locally

```
cd app
npm install
npm run dev
```

## 6. Deploy the frontend

Easiest option — deploy straight from the `app/` folder with
Wrangler (it's already configured in `app/wrangler.toml`):

```
cd app
npm run build
wrangler deploy
```

Or connect the repo to Cloudflare Pages: build command `npm run
build`, output directory `dist`.

---

## How it works

- The frontend keeps a `conversation_id` in memory once the first
  reply comes back, and sends it with every follow-up message so the
  Worker can continue the same conversation (Mistral stores the
  history server-side — the Worker doesn't need a database).
- The Worker never exposes your API key to the browser; all requests
  to `api.mistral.ai` happen server-side.
- To add tools (web search, code execution, image generation), add a
  `tools` array to the "new conversation" payload in
  `worker/src/index.ts` — see
  https://docs.mistral.ai/agents/agents_basics for the tool types.
- To stream tokens instead of waiting for the full reply, set
  `stream: true` in the payload and switch the Worker to relay
  Mistral's `text/event-stream` response.
