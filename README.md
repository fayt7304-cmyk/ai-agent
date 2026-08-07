# Paul — Your Personal AI Agent (v10.4)

A comprehensive chat web application powered by a Mistral AI agent, designed to run entirely on your own Cloudflare account for maximum privacy and control.

---

## 🚀 What's New in v10.4 — Native apps / PWA shell

| Feature | Description |
| :--- | :--- |
| **Installable PWA** | Enhanced `manifest.json` (standalone, shortcuts, share target). |
| **Service worker v4** | App-shell cache, offline page, update banner. |
| **Install banner** | Chrome/Android install prompt + Settings → Install app how-to (iOS included). |
| **Standalone chrome** | Safe-area insets, offline chip, home-screen shortcuts (New chat / Quote). |
| **Share target** | Share text/links into Paul from other apps. |

True native App Store binaries are still a separate project; this is the production **installable web app** path.

### From v10.3 — Voice / calls / roles


| Feature | Description |
| :--- | :--- |
| **Voice notes** | Attach menu → **Voice note** records audio and attaches it; plays inline in the thread. |
| **Voice calls** | 📞 in friend DMs — WebRTC audio via **CallRoom** Durable Object signaling (`CALLS` binding). |
| **Staff roles** | Three missions: **Owner** (full), **Moderator** (ban/view users), **Catalog** (RAG sheets only). Owners assign roles by username. |

### From v10.2 — Presence + admin tools


| Feature | Description |
| :--- | :--- |
| **PresenceHub DO** | Real-time online presence via Cloudflare Durable Object (`PRESENCE` binding). Clients connect to `/api/presence/live`. |
| **Online dots** | Admin user list shows live online/offline; DM header uses DO presence when available. |
| **Admin ⋯ menu** | Per-user: **Change password**, **Ban / Unban**, **Delete account** (admin only). |
| **Ban enforcement** | Banned users cannot log in; active sessions cleared. |

### From v10.1 — Full vector RAG


| Feature | Description |
| :--- | :--- |
| **Workers AI embeddings** | Catalog docs embedded with `@cf/baai/bge-base-en-v1.5` (fallback `bge-small`) via the existing `AI` binding. |
| **Vector retrieval** | Queries ranked by **cosine similarity** against stored vectors in D1 (`knowledge_docs.embedding`). |
| **Hybrid boost** | Light keyword boost so exact product names still rank high. |
| **Keyword fallback** | If AI is down or a doc has no embedding, falls back to keyword scoring. |
| **Re-embed all** | Admin button re-indexes the whole catalog. |
| **CMS status** | Each entry shows `vector ✓` / `no vector`; header shows AI readiness. |

### Roadmap (later)

| Version | Item |
| :--- | :--- |
| **10.2** | ✅ Durable Objects presence + admin user tools |
| **10.3** | ✅ Voice notes / calls + staff roles |
| **10.4** | ✅ Native apps / PWA shell |
| **10.5** | Multi-agent marketplace |

### From v10

Catalog CMS layout fix, quote dimensions, usage remaining, admin users, inline media.

### From v9.9 — Business / marble value


### From v9.8 — Social chat depth

| Feature | Description |
| :--- | :--- |
| **Unread badges** | Sidebar counts for DMs / collab. |
| **Browser notifications** | Background peer messages. |
| **Edit / delete own message** | Soft edit + soft delete. |
| **Search in conversation** | Ctrl/⌘+F. |
| **Block list UI** | Settings → Privacy. |
| **Faster DM ↔ chat URL** | Optimistic hash on sidebar click. |

### From v9.7 — Stability & clarity

| Fix / polish | Description |
| :--- | :--- |
| **URL routing for DMs** | Switching from a friend DM (`#user=…`) back to a normal Paul chat now correctly writes `#conv=…`. |
| **Access forbidden** | Private / missing conversations hide the composer and quick actions. |

### From v9.6 and earlier

This version (v9) ships server-side tools, high-quality voice, memory self-edit, and UI polish for mobile + desktop (including Arabic / RTL).

| Feature | Description |
| :--- | :--- |
| **Agent tools** | Time, weather, translate, and stock quotes run on the Worker (`function.call` → `function.result` loop). Short 5‑minute cache for weather / stocks. |
| **OCR** | `POST /api/ocr` via **Mistral Document AI** on your Worker — no separate OCR worker. |
| **Background removal** | `POST /api/bg-remove` via **Cloudflare Images** (`segment=foreground`) — no ~80 MB model in the browser. |
| **TTS** | Cloudflare **`elevenlabs/eleven-multilingual-v2`** with fallbacks (ElevenLabs key → MeloTTS → Deepgram Aura → device). |
| **Tools health** | `GET /api/tools/health` surfaces OCR / bg-remove / TTS config issues in the Tools UI. |
| **Memory self-edit** | Users can edit title & content in Settings → Memory (dedicated section), not only via “talk to Paul”. |
| **Language / RTL** | Language & Learn more submenus work after switching to Arabic; attach (+) menu anchors correctly in RTL. |
| **Settings layout** | Labels and controls side-by-side (not centered); mobile tab spacing; Manage memory stacking fixed. |

### From earlier releases (v8.x → v8.1)

| Area | Change |
| :--- | :--- |
| **Profile menu** | Claude-style menu: email header, Settings, Language ›, Learn more, Log out, theme row |
| **Mobile** | Full-screen settings sheet, pill tabs, 768px breakpoint, safe-area, 16px inputs (no iOS zoom) |
| **Guest sessions** | Hard **30-day** expiry; abandoned guests cleaned up |
| **Account deletion** | Soft-delete with **7-day** grace; Resend email; **Keep my account** |
| **Sessions** | User-Agent shown (e.g. Chrome on Windows); terminate other devices |
| **i18n** | en · fr · es · zh · ar |

---

## 🛠️ Comprehensive Setup Guide

Follow these steps to set up your own instance of Paul from scratch.

### 1. Prerequisites & API Keys

Before starting, collect the following:

| Key / account | Required | Used for |
| :--- | :---: | :--- |
| **[Mistral AI](https://console.mistral.ai/)** API key + **Agent ID** | Yes | Chat + agent tools + OCR |
| **Cloudflare** account | Yes | Worker, D1, AI, Images |
| **[Resend](https://resend.com/)** API key | Recommended | Password reset, soft-delete email, leads |
| **Google Cloud** OAuth client | Optional | Sign in / link Google |
| **ElevenLabs** API key *or* Workers AI | Optional | High-quality voice (`/api/tts`) |

For Google Login, add your callback to Authorized redirect URIs, e.g.  
`https://api.yourdomain.com/api/auth/google/callback`.

---

### 2. Backend Setup (Cloudflare Worker)

The backend handles auth, database, chat, tools, memory, OCR, TTS, and email.

#### A. Initialize Wrangler

```bash
npm install -g wrangler
wrangler login
cd worker
npm install
```

#### B. Create the Database

```bash
wrangler d1 create mistral-agent-chat-db
```

Copy the `database_id` into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mistral-agent-chat-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

Ensure these bindings exist in `wrangler.toml`:

```toml
[ai]
binding = "AI"

[images]
binding = "IMAGES"
```

#### C. Run Migrations

Apply schema + versioned migrations (**use `--remote` for production**):

```bash
wrangler d1 execute mistral-agent-chat-db --remote --file=./schema.sql

wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0002_oauth_and_reset.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0003_leads.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0004_profile.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0005_star_archive.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0006_conversation_visibility.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0007_memory.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0008_account_deletion.sql
wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0009_session_user_agent.sql
```

#### D. Configure Secrets & Vars

Secrets (encrypted):

```bash
wrangler secret put MISTRAL_API_KEY
# Optional but recommended
wrangler secret put RESEND_API_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put ELEVENLABS_API_KEY
# Optional Workers AI REST fallback
# wrangler secret put CLOUDFLARE_AI_TOKEN
# wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

Public vars in `wrangler.toml` `[vars]`:

| Variable | Example | Purpose |
| :--- | :--- | :--- |
| `MISTRAL_AGENT_ID` | `ag_…` | Your agent from the Mistral console |
| `FRONTEND_URL` | `https://ai.example.com` | App origin |
| `COOKIE_DOMAIN` | `.example.com` | Shared cookie across app + API host |
| `GOOGLE_REDIRECT_URI` | `https://api.example.com/api/auth/google/callback` | OAuth callback |
| `RESEND_FROM` | `Agent <noreply@example.com>` | From address |
| `LEAD_NOTIFY_TO` | `you@example.com` | Lead form inbox |

#### E. Deploy Backend

```bash
wrangler deploy
wrangler tail   # optional live logs
```

Note your Worker URL (e.g. `https://mistral-agent-chat.<subdomain>.workers.dev`) or attach a custom domain such as `api.yourdomain.com`.

---

### 3. Frontend Setup (Vite + TypeScript)

#### A. Connect to Backend

Point the SPA at your Worker. Either:

- Set `VITE_API_BASE` in `app/.env` (see `app/.env.example`), or  
- Ensure `app/src/api.ts` resolves to your API origin (e.g. `https://api.afmarbre.com`).

```bash
# example
echo 'VITE_API_BASE=https://api.yourdomain.com' > app/.env
```

#### B. Build & Deploy

```bash
cd app
npm install
npm run build
```

Host the `dist/` folder on **Cloudflare Pages**, any static host, or your CDN.

Dev:

```bash
npm run dev
```

---

### 4. Custom Domain Configuration

1. **Frontend** — Cloudflare Dashboard → Workers & Pages → your Pages project → **Custom Domains** (e.g. `ai.yourdomain.com`).
2. **Backend** — Worker → **Settings → Domains & Routes** → add `api.yourdomain.com`.
3. Set `COOKIE_DOMAIN=".yourdomain.com"` so login works on mobile (same-site cookie).
4. Update Google OAuth redirect URI and `API_BASE` / `VITE_API_BASE`, then rebuild the frontend.

Full operational notes: `DEPLOY_CHECKLIST.md`.

---

## 📂 Project Structure

```text
repo/
  app/                      # Vite + TypeScript SPA
    src/
      api.ts                # API client (API_BASE / VITE_API_BASE)
      main.ts               # Bootstrap, language menu, theme
      chat-view.ts          # Chat UI, composer, attach menu
      settings-view.ts      # General / Account / Privacy / Memory
      tools-view.ts         # Converter, OCR, bg-remove, weather, …
      lib/
        i18n.ts             # en · fr · es · zh · ar
        speech.ts           # TTS client
        ocr.ts              # OCR → /api/ocr
        bgRemove.ts         # BG remove → /api/bg-remove
      style.css             # Core + responsive + settings layout
      rtl-fixes.css         # Arabic / RTL overrides
  worker/
    schema.sql              # Base D1 schema
    migrations/             # 0002 … 0009
    wrangler.toml           # D1, AI, Images, vars
    src/
      index.ts              # Router: chat, auth, OCR, TTS, bg-remove, tools health
      mistral.ts            # Agent calls + tool runners (time/weather/translate/stock)
      auth.ts               # Sessions, guests, passwords
      email.ts              # Resend
  README.md
  DEPLOY_CHECKLIST.md
```

---

## 🧠 Core Features

- **Privacy-first** — Data stays in your Cloudflare account (D1 + Worker).
- **Mistral agent** — Model, instructions, and tool *definitions* live on the agent; the Worker **executes** time, weather, translate, and stocks.
- **Intelligent memory** — Learns from chats; users can list, talk-to-Paul, or **self-edit** entries.
- **Tools** — OCR, background removal, converter, weather, calculator, PDF/DOCX helpers.
- **High-quality voice** — ElevenLabs multilingual path with automatic fallbacks.
- **Full customization** — Themes, typography, motion, voice; languages including Arabic (RTL).
- **Auth** — Guests (30 days), registered accounts, Google link, soft-delete (7-day grace), multi-device sessions.
- **PWA ready** — Installable on iOS, Android, and desktop.

---

## 🔌 Important API routes

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `POST` | `/api/chat` | Chat + agent tool loop |
| `POST` | `/api/ocr` | Document / image OCR (Mistral) |
| `POST` | `/api/bg-remove` | Background removal (Cloudflare Images) |
| `POST` | `/api/tts` | Text-to-speech |
| `GET` | `/api/tools/health` | OCR / bg-remove / TTS / agent-tools status |
| `PATCH` | `/api/memory/:id` | Direct memory title/content update |

---

## 🔊 High-quality voice (TTS)

`/api/tts` tries, in order:

1. **Cloudflare AI binding** — `elevenlabs/eleven-multilingual-v2` (`[ai] binding = "AI"`)
2. **ElevenLabs API** — secret `ELEVENLABS_API_KEY`
3. **Workers AI fallbacks** — MeloTTS / Deepgram Aura
4. **Device** — browser speech synthesis if the API returns 501

```bash
cd worker
npx wrangler secret put ELEVENLABS_API_KEY   # optional but recommended
npx wrangler deploy
```

Templates: `worker/.dev.vars.example`, `app/.env.example`.

---

## 📝 Memory editing

1. Open **Settings → Memory**.
2. Open an entry.
3. Use **Edit** for a dedicated edit section (title + content), or type an instruction for Paul.
4. Save or go back to the detail view.

API: `PATCH /api/memory/:id` with `{ "title": "...", "content": "..." }`.

---

## ⚠️ Known console notes

- **`/api/tts` → 501** — High-quality voice not configured; browser TTS still works.
- **OCR / bg-remove 501** — Check `MISTRAL_API_KEY` and the `[images]` binding; Tools UI shows a health note.
- Browser extension noise (adblock, fingerprint scripts) is unrelated to Paul.

---

## 📌 Version

**9.6.0** — Read receipts, presence, @all, RAG citations, stream reveal, activity log.

**9.5.0** — Friend DMs (`#user=`), @paul in collab+DM, live friend requests (WS), owner-only manage, polished group/DM bubbles.

**9.4.0** — Friends system, 1:1 DMs with live WebSocket, @paul tag only in collab.

**9.3.0** — Live collab (WebSocket + poll), group ownership UI (mine vs others), @paul tag to summon Paul in collab, lock Only me after peer message.

**9.2.0** — Manage chat share panel, collab codes, admin logs, group collab UI.
**9.0.0** — Agent tools, server OCR & bg-remove, TTS, tools health, memory self-edit, RTL / settings polish.

Earlier notes for v8.x / v7 remain in git history.

---

## License / use

Self-host for your own use. Respect Mistral, Cloudflare, and any third-party API terms when you deploy.
