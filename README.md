# Paul — Your Personal AI Agent

A chat web app powered by a Mistral AI agent, running entirely on
your own Cloudflare account:

- **Worker backend** — keeps your Mistral API key private, handles
  login/signup, stores accounts + conversations + messages in a D1
  database (SQLite on Cloudflare's edge). No third-party auth or
  storage provider — it's all your Worker.
- **Frontend** — a small vanilla TS/Vite chat UI: sidebar with your
  conversation history, file attachments (images + documents), a
  comprehensive settings panel with voice, animations, fonts, and data
  management, dark/light/system theme, and a login/signup screen.

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
- **Settings**: theme (light/dark/system), model, agent instructions,
  voice settings (language, style, speed), animation levels, font
  family/size, and data management (export, session management, memory
  generation) live per-account in D1 and apply after saving. Theme and
  preferences also have immediate local preview + `localStorage` fallback
  for the instant before a session is confirmed.
- **Theming**: `app/src/theme.ts` applies a `data-theme` attribute on
  `<html>`; `app/src/style.css` defines light and dark variable sets
  under `:root`/`[data-theme="light"]` and `[data-theme="dark"]`.
- **Preferences**: `app/src/lib/preferences.ts` manages voice, animation,
  and font settings with CSS variables (`--transition-duration`,
  `--anim-level`, `--font-family`, `--base-font-size`) that are applied
  globally and persist in `localStorage`.
- To add tools (web search, code execution, image generation), add a
  `tools` array to the "new conversation" payload in
  `worker/src/mistral.ts` — see
  https://docs.mistral.ai/agents/agents_basics for the tool types.
- To stream tokens instead of waiting for the full reply, set
  `stream: true` in `worker/src/mistral.ts` and switch the Worker to
  relay Mistral's `text/event-stream` response (the frontend would
  then need to read the stream incrementally too). **Not yet wired
  up** — see "What's new" below.

## What's new

- **Rebranded to Paul** — the agent is now called "Paul" throughout the
  app, with all references updated from "Agent" to "Paul".
- **Voice Settings** — users can choose voice language (8 languages),
  voice style (Natural, Formal, Friendly, Calm), and voice speed
  (0.5x–2x). Settings are persisted in `localStorage` for immediate
  application.
- **Animation & Motion Controls** — users can set animation level
  (None, Reduced, Normal) to control the amount of motion in the app,
  respecting accessibility preferences. Font family (System Default,
  Serif, Monospace, Rounded) and font size (12–18px) are also
  customizable.
- **Data Management** — users can export all their data as JSON,
  manage uploaded files, view active sessions, and generate memories
  from conversations for Paul to remember important details.
- **Global Animations** — smooth transitions and slide-in animations
  for messages, modals, and UI elements, with full support for
  `prefers-reduced-motion` accessibility preference.
- **Image Cropping** — when uploading profile pictures or photos,
  users can interactively crop images with Cropper.js. The crop UI
  is optimized for both desktop and mobile devices.
- **Full Arabic Localization** — all 50+ unit categories and units in
  the converter are now translated to Arabic, along with all new
  settings labels.
- **Markdown rendering** — agent replies render bold/italic/lists/
  headings/code/links instead of showing raw `**`/`#` characters
  (`app/src/lib/markdown.ts`, a small dependency-free renderer).
- **Copy button** on every agent message; **🔄 Try again** on the
  most recent one (resends your last message as a fresh turn — not
  a true delete-and-redo, since Mistral's conversation memory means
  the old exchange stays in context).
- **Quick-action buttons** above the composer — edit `QUICK_ACTIONS`
  in `app/src/chat-view.ts`.
- **Lead capture / quote requests** — the "📋 Get a quote" button
  opens a name/phone/email/message/photo form. Submissions are
  stored in a new `leads` D1 table and, if `LEAD_NOTIFY_TO` is set,
  emailed to your team via Resend. Only photo *metadata* is sent
  (same pattern as chat attachments) — the file itself stays local
  unless you extend this to actually upload it (e.g. to R2).
- **Rate limiting** — set `MAX_MESSAGES_PER_DAY` in
  `worker/wrangler.toml` to cap messages per user per rolling 24h.
  Unset = unlimited.
- **Tools panel** (🧰 button) — wires up four previously-unused
  helpers in `app/src/lib/`: OCR (`ocr.ts` — note it calls a
  *separate* already-deployed Worker at the URL in that file, not
  this one), background removal, PNG/JPEG/WebP conversion, and
  Markdown → Word export.
- **PWA install prompt** — `app/public/manifest.json` + `sw.js`
  (app-shell caching only, never intercepts `/api/*`) + an install
  button that appears when the browser fires `beforeinstallprompt`.
  The bundled icons (`app/public/icons/`) are placeholders — swap
  them for real branding.
- **Profile customization** — users can set a display name and upload
  a profile picture (with interactive cropping). Google login
  automatically syncs the profile picture from their Google account.
- **Preferences system** (`app/src/lib/preferences.ts`) — handles
  animation levels, font settings, and voice preferences with
  `localStorage` persistence and CSS variable injection for
  theme-aware styling.
- **Not done**: true streaming responses — see the note above.

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
    settings-view.ts        settings modal logic + voice/animation/font handlers
    theme.ts                light/dark/system theme handling
    files.ts                attachment reading/formatting helpers
    lib/
      preferences.ts        voice, animation, font settings with localStorage
      cropper.ts            interactive image cropping UI
      i18n.ts               internationalization (8 languages, full Arabic)
      uconvert.ts           unit converter with translated categories/units
    style.css                all styling (light + dark) + animations
```
