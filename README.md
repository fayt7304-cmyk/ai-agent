# Paul — Your Personal AI Agent

A comprehensive chat web application powered by a Mistral AI agent, designed to run entirely on your own Cloudflare account for maximum privacy and control.

- **Worker Backend** — A Cloudflare Worker that keeps your Mistral API key secure, handles authentication (including Google OAuth), and manages data in a Cloudflare D1 (SQLite) database.
- **Frontend** — A high-performance vanilla TypeScript/Vite UI featuring a sidebar with chat history, file attachments, a robust settings panel, and a responsive design with full dark/light/system theme support.

---

## 🚀 What's New & Fixed

The latest deployment includes full implementation of previously missing features and UI enhancements:

- **Top Bar Actions** — Added quick-access icons in the header for AI Actions, Sharing, Usage stats, File search, Theme toggle, and More.
- **Font Settings Fixed** — Custom font families (Serif, Monospace, Rounded) now apply correctly across the entire app.
- **Voice Settings Fixed** — Voice language and speaking speed settings are now correctly applied to the text-to-speech engine.
- **Account Deletion** — Users can now permanently delete their accounts and all associated data directly from the settings panel.
- **Session Management** — View all active browser sessions and revoke specific ones to secure your account.
- **Memory Generation** — Paul can now generate a "memory profile" by summarizing your last 50 messages, helping the agent remember your preferences and interests.
- **Transparent Branding** — The website favicon and app icons have been updated to a modern white-on-transparent design, removing the old solid white backgrounds.

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
```
