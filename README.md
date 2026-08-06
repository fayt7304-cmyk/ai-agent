# Paul — Your Personal AI Agent (v7)

A comprehensive chat web application powered by a Mistral AI agent, designed to run entirely on your own Cloudflare account for maximum privacy and control.

---

## 🚀 What's New in v7

This version (v7) introduces critical layout fixes and structural improvements:

| Feature | Fix Description |
| :--- | :--- |
| **Mobile Sidebar** | Updated the responsive breakpoint to **768px** and added `z-index` layering to ensure the sidebar correctly overlays the chat content on all mobile devices. |
| **Calculator Modal** | Standardized the height of input fields and dropdowns to **42px** to perfectly align with the **Plot** button in the graph view. |
| **User Menu** | Adjusted the icon container's `line-height` and alignment properties to ensure icons are vertically centered with their labels on both mobile and desktop. |

---

## 🛠️ Comprehensive Setup Guide

Follow these steps to set up your own instance of Paul from scratch.

### 1. Prerequisites & API Keys

Before starting, you need to collect the following API keys:

- **Mistral AI**: Sign up at the [Mistral AI Console](https://console.mistral.ai/), create an **API Key**, and optionally create a custom **Agent** to get an `Agent ID`.
- **Google Cloud (Optional for OAuth)**: If you want Google Login, create a project in the [Google Cloud Console](https://console.cloud.google.com/), set up an OAuth 2.0 Client ID, and add `https://your-worker-url.workers.dev/api/auth/google/callback` to the Authorized redirect URIs.
- **Resend (Optional for Leads)**: If you want email notifications for new leads, get an API key from [Resend](https://resend.com/).

### 2. Backend Setup (Cloudflare Worker)

The backend handles all sensitive logic, database interactions, and API calls.

#### A. Initialize Wrangler
```bash
npm install -g wrangler
wrangler login
cd worker
npm install
```

#### B. Create the Database
Create a Cloudflare D1 database:
```bash
wrangler d1 create mistral-agent-chat-db
```
Copy the `database_id` from the output and paste it into `worker/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "mistral-agent-chat-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

#### C. Run Migrations
Apply the database schema and all versioned migrations:
```bash
# Initialize schema
wrangler d1 execute mistral-agent-chat-db --file=./schema.sql --remote

# Apply versioned migrations (run these in order)
wrangler d1 execute mistral-agent-chat-db --file=./migrations/0002_oauth_and_reset.sql --remote
wrangler d1 execute mistral-agent-chat-db --file=./migrations/0003_leads.sql --remote
wrangler d1 execute mistral-agent-chat-db --file=./migrations/0004_profile.sql --remote
wrangler d1 execute mistral-agent-chat-db --file=./migrations/0005_star_archive.sql --remote
wrangler d1 execute mistral-agent-chat-db --file=./migrations/0006_conversation_visibility.sql --remote
wrangler d1 execute mistral-agent-chat-db --file=./migrations/0007_memory.sql --remote
```

#### D. Configure Secrets
Set your sensitive API keys as encrypted secrets on Cloudflare:
```bash
wrangler secret put MISTRAL_API_KEY
# Optional secrets
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put RESEND_API_KEY
```

#### E. Deploy Backend
```bash
wrangler deploy
```
Note your Worker URL (e.g., `https://mistral-agent.username.workers.dev`).

---

### 3. Frontend Setup (Vite + TypeScript)

The frontend is a high-performance web app that connects to your Worker.

#### A. Connect to Backend
Open `app/src/api.ts` and update the `API_BASE` constant with your Worker URL:
```ts
export const API_BASE = "https://mistral-agent.username.workers.dev";
```

#### B. Build & Deploy
```bash
cd app
npm install
npm run build
wrangler deploy
```

---

### 4. Custom Domain Configuration

To point your own domain (e.g., `chat.yourdomain.com`) to the app:

1. **For the Frontend**:
   - Go to the **Cloudflare Dashboard** → **Workers & Pages** → Your Frontend Project.
   - Select **Custom Domains** and click **Set up a custom domain**.
   - Enter your domain (e.g., `chat.yourdomain.com`) and follow the CNAME setup instructions.

2. **For the Backend (API)**:
   - Go to the **Cloudflare Dashboard** → **Workers & Pages** → Your Backend Worker.
   - Select **Settings** → **Triggers** → **Custom Domains**.
   - Add a domain like `api.yourdomain.com`.
   - **Important**: If you change the API domain, remember to update `API_BASE` in `app/src/api.ts` and redeploy the frontend.

---

## 📂 Project Structure

```text
worker/
  schema.sql          Base D1 database schema
  migrations/         Incremental database updates (v2 to v7)
  src/
    index.ts          Main router & API endpoints
    auth.ts           Security, Hashing & Session logic
    mistral.ts        Mistral AI integration client
app/
  src/
    api.ts            Frontend API client (Set API_BASE here)
    main.ts           App bootstrap & Global coordination
    chat-view.ts      Chat UI, Sidebar & Message handling
    style.css         Core styling & Responsive layouts (v7 fixes here)
```

---

## 🧠 Core Features

- **Privacy-First**: Your data stays in your Cloudflare account.
- **Intelligent Memory**: Paul learns from your chats and maintains context across conversations.
- **Advanced Tools**: Integrated OCR, Image Background Removal, and Unit Conversion.
- **Full Customization**: Themes (Dark/Light/System), Typography, and Voice settings.
- **PWA Ready**: Installable on iOS, Android, and Desktop for a native app experience.
