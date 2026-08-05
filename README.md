# Paul — Your Personal AI Agent

A comprehensive chat web application powered by a Mistral AI agent, designed to run entirely on your own Cloudflare account for maximum privacy and control.

- **Worker Backend** — A Cloudflare Worker that keeps your Mistral API key secure, handles authentication (including Google OAuth), and manages data in a Cloudflare D1 (SQLite) database.
- **Frontend** — A high-performance vanilla TypeScript/Vite UI featuring a sidebar with chat history, file attachments, a robust settings panel, and a responsive design with full dark/light/system theme support.

---

## 🚀 What's New & Fixed

The latest deployment includes full implementation of previously missing features and UI enhancements:

- **Functional Top Bar** — Replaced generic icons with task-specific actions:
  - **Usage & Credits (Chart)**: Real-time overlay showing credits used (891) and time worked (12m 14s).
  - **View Files (File Search)**: Dedicated modal to see all files associated with the current task.
  - **Share (Arrow)**: New dropdown menu with sharing levels (Only Me, Share with People, Collaboration).
  - **More (Dots)**: Task-specific actions: Rename, Archive, and Delete.
- **Cleaned UI** — Removed the brush/pencil icon and all "star" related features to maintain a minimal, focused workspace.
- **Font Settings Fixed** — Custom font families (Serif, Monospace, Rounded) now apply correctly across the entire app.
- **Voice Settings Fixed** — Voice language and speaking speed settings are now correctly applied to the text-to-speech engine.
- **Account Deletion** — Users can now permanently delete their accounts and all associated data directly from the settings panel.
- **Session Management** — View all active browser sessions and revoke specific ones to secure your account.
- **Memory Generation** — Paul can now generate a "memory profile" by summarizing your last 50 messages, helping the agent remember your preferences and interests.
- **Transparent Branding** — The website favicon and app icons have been updated to a modern white-on-transparent design.

---

## 🛠️ Getting Started

### 1. Mistral API Configuration
Sign up at [Mistral AI Console](https://console.mistral.ai/) and create an **API Key**. For the best experience, create a custom **Agent** and note its `Agent ID`.

### 2. Database Setup
```bash
npm install -g wrangler
wrangler login
cd worker
npm install
wrangler d1 create mistral-agent-chat-db
```
Copy the `database_id` from the output into `worker/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "mistral-agent-chat-db"
database_id = "YOUR_DATABASE_ID"
```
Apply the schema:
```bash
npm run db:migrate:remote
```

### 3. Deploy the Backend
```bash
wrangler secret put MISTRAL_API_KEY
wrangler deploy
```
Note your Worker URL (e.g., `https://mistral-agent.YOUR-SUBDOMAIN.workers.dev`).

### 4. Configure the Frontend
Open `app/src/api.ts` and update `API_BASE`:
```ts
export const API_BASE = "https://mistral-agent.YOUR-SUBDOMAIN.workers.dev";
```

### 5. Deploy the Frontend
```bash
cd app
npm install
npm run build
wrangler deploy
```

---

## 🧠 Features & Architecture

### Privacy-First Authentication
- **Local Accounts**: Hashed with PBKDF2-SHA256 (100k iterations).
- **Google OAuth**: Seamless sign-in and account linking.
- **Guest Mode**: Allows users to try the app instantly without an account, with the option to "claim" the account later to keep history.
- **Session Control**: `HttpOnly` secure cookies with a dedicated management interface to revoke stolen or old tokens.

### Intelligent Conversations
- **Mistral Integration**: Uses the Conversations API to maintain thread context.
- **File Attachments**: Supports images and documents (PDFs, etc.) sent directly to vision-capable models.
- **Quick Actions**: Customizable buttons for common tasks like summarizing or brainstorming.

### Advanced Customization
- **Voice Engine**: Configure language (8+ supported) and speed for the built-in read-aloud feature.
- **Accessibility**: Motion controls for `prefers-reduced-motion` and customizable typography (System, Serif, Monospace, Rounded).
- **Tools Panel**: Integrated OCR, background removal, and image conversion utilities.

### Lead Capture
- Built-in quote request system that stores leads in D1 and can notify your team via **Resend** email integration.

---

## 📂 Project Structure

```text
worker/
  schema.sql          D1 database schema
  src/
    index.ts          Main router (Auth, Settings, Sessions, Chat, Memory)
    auth.ts           Session & Password security logic
    mistral.ts        Mistral API client
    email.ts          Resend email integration
app/
  src/
    api.ts            Frontend API client
    main.ts           App bootstrap & View coordination
    chat-view.ts      Messaging & Composer logic
    settings-view.ts  Settings & Data management UI
    lib/
      preferences.ts  User preference persistence
      i18n.ts         Multi-language support (inc. Arabic)
      markdown.ts     Custom Markdown renderer
      icons.ts        SVG Icon library
```

---

## 🧠 Paul's Memory (cross-chat)

Paul remembers durable facts about you — who you are, what you prefer, what you're
working on — and reuses them in **every** new conversation, not just the current one.

- **Settings → Memory** is its own tab (next to General / Account / Privacy).
  - *Generate memory from chats* switch (`users.memory_enabled`).
  - *Manage memory*: review each entry, delete anything, add your own with
    "Tell Paul what to remember", or hit **Update from chats** to re-read your
    recent history.
- Memory is injected into the first turn of every new conversation as a short
  "known about this user" block; later turns already carry it in the thread.
- New entries are extracted in the background after each exchange, so replies are
  never slowed down by it.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/memory` | List entries + the on/off state |
| `POST` | `/api/memory` | Add / update one entry (`{ content, title? }`) |
| `DELETE` | `/api/memory/:id` | Forget one entry |
| `PATCH` | `/api/memory/settings` | Toggle `{ enabled }` |
| `POST` | `/api/memory/generate` | Re-read recent chats and store entries |

### Database migration (terminal)

The memory feature adds a `memories` table and a `users.memory_enabled` column.
Apply it with Wrangler:

```sh
cd worker

# Local D1 (dev)
npx wrangler d1 execute mistral-agent-chat-db --file=./migrations/0007_memory.sql --local

# Production D1
npx wrangler d1 execute mistral-agent-chat-db --file=./migrations/0007_memory.sql --remote

# Verify
npx wrangler d1 execute mistral-agent-chat-db --command "SELECT COUNT(*) FROM memories;" --remote
```

If the last statement errors with `duplicate column name: memory_enabled`, the
column already exists and the rest of the migration has been applied — safe to ignore.

Then redeploy the Worker so the new endpoints go live:

```sh
cd worker && npx wrangler deploy
```

---

## 🗒 Recent changes

- **Arabic (and other non-Latin) read-aloud fixed** — `POST /api/tts` returned
  **502** because `eleven_turbo_v2` is English-only. The Worker now picks a
  language-appropriate ElevenLabs model (`eleven_multilingual_v2` for Arabic),
  retries without the unsupported `speed` parameter, and answers **501** instead of
  502 when a language genuinely isn't available so the app quietly uses the device
  voice with no red error banner. MeloTTS (the Workers AI fallback) also returns
  501 for languages it has no voice for, instead of reading Arabic with an English voice.
- **High-quality voice latency / double-talk** — TTS streams (`/stream` +
  `optimize_streaming_latency`), and a generation counter discards superseded audio
  so the device voice and the studio voice can no longer talk over each other.
- **Google connect works** — the OAuth `state` is now HMAC-signed, so the callback
  verifies it without needing the `oauth_state` cookie (which mobile browsers drop
  on the cross-site callback hop). The session is refreshed before the redirect so
  the linking token is always present.
- **Memory** — new Memory settings tab, `memories` table, and cross-chat recall
  (replaces the old "Generate Memory from Chats" .txt download).
- **Settings redesigned Claude-style** — flat rows with hairline dividers, labels
  left / controls right, sidebar section icons, and corrected mobile rows.
- **Golden branding** — new gold "P" favicon (`app/public/favicon.svg` + PNG/ICO set).
- **Installed app no longer flashes white** — manifest `background_color` /
  `theme_color` follow the app theme, plus an inline pre-CSS background paint.
