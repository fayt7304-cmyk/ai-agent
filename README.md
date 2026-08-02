# Mistral Agent Chat

A chat web app powered by a Mistral AI agent, running entirely on
your own Cloudflare account:

- **Worker backend** — keeps your Mistral API key private, handles
  login/signup, stores accounts + conversations + messages in a D1
  database (SQLite on Cloudflare's edge). No third-party auth or
  storage provider — it's all your Worker.
- **Frontend** — a small vanilla TS/Vite chat UI: sidebar with your
  conversation history, file attachments (images + documents), a
  settings panel, dark/light/system theme, and a login/signup screen.

---

## 1. Get a Mistral API key

Sign up at https://console.mistral.ai/, then create a key under
**API keys**.

## 2. Create the D1 database

```
npm install -g wrangler
wrangler login
cd worker
npm install
wrangler d1 create mistral-agent-chat-db
```

This prints a `database_id`. Paste it into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mistral-agent-chat-db"
database_id = "paste-the-id-here"
```

Then apply the schema:

```
npm run db:migrate:remote
```

## 3. Deploy the Worker (backend)

```
wrangler secret put MISTRAL_API_KEY
wrangler deploy
```

Wrangler prints a URL like:
```
https://mistral-agent-chat.YOUR-SUBDOMAIN.workers.dev
```

## 4. Customize your agent's defaults (optional)

Open `worker/src/index.ts`:

```ts
const DEFAULT_MODEL = "mistral-medium-latest";
const DEFAULT_INSTRUCTIONS = "You are a helpful, friendly assistant. Answer clearly and concisely.";
```

These are just the defaults for new accounts — each user can change
their own model and instructions from the **Settings** panel in the
app, no redeploy needed.

Other models you can offer: `mistral-large-latest`,
`mistral-small-latest`, `magistral-medium-latest` (reasoning),
`codestral-latest` (code). Edit the `ALLOWED_MODELS` list and the
`<select id="model-select">` options in `app/index.html` if you add
more.

## 5. Point the frontend at your Worker

Open `app/src/api.ts` and set:

```ts
export const API_BASE = "https://mistral-agent-chat.YOUR-SUBDOMAIN.workers.dev";
```

(No trailing slash, no `/api/chat` — just the Worker's origin.)

## 6. Run locally

```
cd app
npm install
npm run dev
```

> **Note:** session cookies are set with `Secure; SameSite=None`,
> which browsers only send over HTTPS. Since the deployed Worker is
> already `https://...workers.dev`, logging in from `localhost` over
> plain `http://` during local dev will still work in most browsers
> (the cookie comes from the HTTPS Worker, and `localhost` is
> commonly treated as a secure context) — but if login doesn't
> persist locally, deploy the frontend (step 7) and test there.

## 7. Deploy the frontend

```
cd app
npm run build
wrangler deploy
```

Or connect the repo to Cloudflare Pages: build command `npm run
build`, output directory `dist`.

## 8. Lock down CORS (recommended once deployed)

By default the Worker reflects whatever `Origin` header it receives,
which is fine for getting started. Once you know your frontend's real
URL, uncomment and set this in `worker/wrangler.toml`, then
`wrangler deploy` again:

```toml
[vars]
ALLOWED_ORIGINS = "https://your-frontend.workers.dev"
```

---

## How it works

- **Accounts**: username + password, hashed with PBKDF2-SHA256
  (Web Crypto, 120k iterations) — nothing sent anywhere but your own
  D1 database. Sessions are random tokens stored server-side and set
  as an `HttpOnly` cookie, so a stolen token can be revoked by
  deleting the row.
- **Conversations & messages**: stored in D1, scoped to the logged-in
  user. Each conversation also keeps Mistral's own `conversation_id`
  so follow-up messages continue the same thread server-side (Mistral
  stores the model's view of the history; your Worker stores the
  display copy for the UI).
- **File attachments**: images are sent to Mistral as base64
  (`image_url` content parts); PDFs/documents as base64
  (`document_url` content parts) so vision- and document-capable
  models can read them directly — no separate file storage bucket
  needed. Only attachment *metadata* (name/type/size) is saved to
  D1, not the file bytes, so re-opening an old conversation shows
  that a file was attached but won't re-display the file itself.
  Default cap is 10MB/file (`MAX_ATTACHMENT_BYTES` in
  `worker/src/index.ts`, mirrored by `MAX_FILE_BYTES` in
  `app/src/files.ts`).
- **Settings**: theme (light/dark/system), model, and agent
  instructions live per-account in D1 and apply to new messages after
  saving. Theme also has an immediate local preview + `localStorage`
  fallback for the instant before a session is confirmed.
- **Theming**: `app/src/theme.ts` applies a `data-theme` attribute on
  `<html>`; `app/src/style.css` defines light and dark variable sets
  under `:root`/`[data-theme="light"]` and `[data-theme="dark"]`.
- To add tools (web search, code execution, image generation), add a
  `tools` array to the "new conversation" payload in
  `worker/src/mistral.ts` — see
  https://docs.mistral.ai/agents/agents_basics for the tool types.
- To stream tokens instead of waiting for the full reply, set
  `stream: true` in `worker/src/mistral.ts` and switch the Worker to
  relay Mistral's `text/event-stream` response (the frontend would
  then need to read the stream incrementally too).

## Project layout

```
worker/
  schema.sql          D1 schema (users, sessions, conversations, messages)
  src/
    index.ts           router: auth, settings, conversations, chat
    auth.ts             password hashing + session cookies
    mistral.ts          calls Mistral's Conversations API
    cors.ts             CORS helpers
    types.ts            shared types
app/
  index.html            auth screen + app shell + settings modal
  src/
    main.ts              bootstraps the app, wires views together
    api.ts                fetch client for the Worker
    auth-view.ts          login/signup form logic
    chat-view.ts           sidebar + messages + composer + attachments
    settings-view.ts        settings modal logic
    theme.ts                light/dark/system theme handling
    files.ts                attachment reading/formatting helpers
    style.css                all styling (light + dark)
```
