# Paul — Personal AI Agent (v8)

Self-hosted chat app powered by a **Mistral AI agent**, running on **Cloudflare Workers + D1**.  
Frontend is a Vite TypeScript SPA; the Worker owns auth, sessions, chat, tools, memory, and email.

---

## What’s new in v8

| Area | Change |
|------|--------|
| **Profile menu** | Claude-style menu: email header, Settings, **Language ›** submenu, Learn more, Log out, theme row |
| **General settings** | Profile + Preferences layout (avatar, full name, preferred name, Appearance icons, Motion, Voice) |
| **Mobile** | Settings full-screen sheet, pill tabs, 768px breakpoint, safe-area, 16px inputs (no iOS zoom) |
| **Guest sessions** | Hard **30-day** expiry; abandoned guests cleaned up; banner copy updated |
| **Account deletion** | **Soft-delete** with **7-day** grace; Resend email; **Keep my account** cancel |
| **Sessions** | **User-Agent** stored and shown (e.g. Chrome on Windows); terminate other devices |
| **i18n / RTL** | en · fr · es · zh · ar; logical CSS; Arabic font stack |
| **Voice** | High-quality path + adaptive delay before browser TTS fallback |

---

## Stack

- **App** (`app/`): Vite, TypeScript, CSS  
- **API** (`worker/`): Cloudflare Worker, D1, Mistral Agent API, optional ElevenLabs / Workers AI TTS, Resend, Google OAuth  

---

## Prerequisites

| Key / account | Required | Used for |
|---------------|----------|----------|
| [Mistral](https://console.mistral.ai/) API key + Agent ID | Yes | Chat |
| Cloudflare account | Yes | Worker + D1 |
| [Resend](https://resend.com/) API key | Soft-delete email + password reset + leads | Email |
| Google OAuth client | Optional | Sign in with Google |
| ElevenLabs or Workers AI TTS | Optional | High-quality voice |

---

## Quick start

### 1. Worker

```bash
cd worker
npm install
npx wrangler login
```

Create D1 and put `database_id` in `wrangler.toml`:

```bash
npx wrangler d1 create mistral-agent-chat-db
```

Apply schema + migrations (**use `--remote` for production**):

```bash
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./schema.sql

npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0002_oauth_and_reset.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0003_leads.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0004_profile.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0005_star_archive.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0006_conversation_visibility.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0007_memory.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0008_account_deletion.sql
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0009_session_user_agent.sql
```

Secrets:

```bash
npx wrangler secret put MISTRAL_API_KEY
npx wrangler secret put RESEND_API_KEY          # optional but recommended
npx wrangler secret put GOOGLE_CLIENT_ID        # optional
npx wrangler secret put GOOGLE_CLIENT_SECRET    # optional
```

Public vars live in `wrangler.toml` `[vars]`:

- `MISTRAL_AGENT_ID`
- `FRONTEND_URL` (e.g. `https://ai.example.com`)
- `RESEND_FROM`
- `COOKIE_DOMAIN` (e.g. `.example.com` for shared cookie across app + API host)
- `GOOGLE_REDIRECT_URI`
- `LEAD_NOTIFY_TO`

Deploy:

```bash
npx wrangler deploy
npx wrangler tail   # optional live logs
```

### 2. Frontend

```bash
cd app
npm install
# Point the SPA at your Worker origin (see vite / API_BASE resolution in src/api.ts)
npm run build
```

Host the `dist/` folder on Cloudflare Pages, any static host, or your own CDN.  
Set the API base so the browser talks to the Worker (custom domain recommended: `api.example.com` + `COOKIE_DOMAIN=.example.com`).

Dev:

```bash
npm run dev
```

---

## Auth & sessions

| Mode | Behavior |
|------|----------|
| **Guest** | Instant account; session **30 days**; not extended by activity; purge of abandoned guests |
| **Registered** | Password and/or Google; session **90 days** |
| **Soft-delete** | `deletion_requested_at` set; still logged in; email via Resend; hard delete after **7 days** unless cancelled |
| **Sessions UI** | Device from User-Agent; revoke others; log out all devices |

---

## Settings overview

- **General** — Profile (avatar, names), Appearance, language, font, motion, voice  
- **Account** — Password, Google link, active sessions + UA, soft-delete  
- **Privacy** — Cookies / privacy choices  
- **Memory** — List / detail, talk-to-Paul revise, import / export  

---

## Tools (in-app)

Converter, weather, calculator, image tools, OCR, PDF/DOCX helpers — labels follow the active UI language where wired.

---

## Wrangler remote cheatsheet

```bash
# Production D1
npx wrangler d1 execute mistral-agent-chat-db --remote --file=./migrations/0009_session_user_agent.sql

# Deploy Worker
npx wrangler deploy

# Logs
npx wrangler tail
```

Omit `--remote` only when intentionally using a **local** D1 with `wrangler dev`.

---

## Project layout

```
repo/
  app/                 # Vite SPA
    src/
      main.ts
      settings-view.ts
      chat-view.ts
      lib/i18n.ts
      style.css
  worker/
    src/index.ts       # API routes
    src/auth.ts        # sessions, guests, passwords
    src/email.ts       # Resend
    migrations/
    schema.sql
    wrangler.toml
  README.md
  DEPLOY_CHECKLIST.md
```

---

## Version

**8.0.0** — see “What’s new in v8” above. Earlier notes for v7 remain in git history.

---

## License / use

Deploy on your own Cloudflare account. You are responsible for Mistral, Resend, and Google terms and for protecting user data in your D1 database.
