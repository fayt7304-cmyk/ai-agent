# Paul — Your Personal AI Agent (v0.10.5 · R1 quiet studio)

A comprehensive chat web application powered by Mistral AI agents, designed to run on your own Cloudflare account for privacy and control.

---

## 🚀 What's New in v0.10.5 — Multi-agent marketplace

| Feature | Description |
| :--- | :--- |
| **Agent marketplace** | Browse public agents in **Settings → Account → Agent marketplace**. |
| **Preferred agent** | Tap **Use for new chats** — stored locally and applied when you start a new conversation. |
| **Per-conversation agent** | Each chat can bind an `agent_id`; Paul resolves the Mistral agent id server-side. |
| **Admin publish** | Owners/admins can publish agents (`name`, `slug`, `mistral_agent_id`, tagline, description). |
| **Default Paul** | Platform seeds a default **Paul** agent from `MISTRAL_AGENT_ID`. |
| **Version in Settings** | **Settings → General → About** shows **0.10.5**. |

### Recent (0.10.x)

| Version | Highlights |
| :--- | :--- |
| **0.10.5** | Multi-agent marketplace |
| **0.10.4** | PWA shell, voice notes/calls polish, media previews, fast chat switch |
| **0.10.3** | Voice notes, WebRTC calls, staff roles |
| **0.10.2** | Durable Objects presence, admin ban/password/delete |
| **0.10.1** | Vector RAG (embeddings) |

### Roadmap

| Item | Status |
| :--- | :--- |
| True Durable Objects presence | ✅ |
| Voice notes / calls | ✅ |
| Native apps / PWA shell | ✅ |
| Multi-agent marketplace | ✅ 0.10.5 |
| Full vector RAG + admin CMS | ✅ keyword + embedding hybrid (ongoing) |

---

## Features

- **Paul chat** — Mistral agent with tools, memory, catalog RAG  
- **Friends & DMs** — realtime, presence, voice notes, calls  
- **Collab chats** — invite codes, @mentions  
- **Marketplace** — switch agents for new threads  
- **Admin** — users, ban, export data, catalog CMS, staff roles, publish agents  
- **PWA** — installable, offline shell  

---

## Deploy

```bash
# Worker
cd worker
npx wrangler d1 migrations apply mistral-agent-chat-db --remote
npx wrangler deploy

# App
cd ../app
npm run build
# deploy dist/ to Pages or your static host
```

### Required secrets / vars

| Name | Purpose |
| :--- | :--- |
| `MISTRAL_API_KEY` | Chat, OCR, memory |
| `MISTRAL_AGENT_ID` | Default Paul agent |
| `PRESENCE` / `CALLS` | Durable Object bindings |
| `AI` | Workers AI embeddings (RAG) |

Migrations include `0018_v105_agents.sql` (agents table). Columns are also ensured at runtime.

---

## Version

**Current: 0.10.5** — multi-agent marketplace.

Shown in Settings → General → About, and via `GET /api/version`.


---

## Design R1 — Quiet studio

North star: *Paul should feel like a quiet studio for marble decisions — not a busy control panel that happens to chat.*

- Warmer paper / charcoal backgrounds
- Muted brass accent (used sparingly)
- Soft stone user bubbles (not loud gold pills)
- Slightly larger reading type (15.5px)
- Low-contrast borders, softer shadows


## Design R2 — Reading column

- More vertical space between messages
- Message actions (reply / edit / delete / speak) **on hover** (always on touch)
- Quieter quick-action chips
- Softer empty state
- Image-only messages without bubble chrome


## Design R3 — Composer

- Single calm rounded strip aligned with the reading column
- No hard top border on the form; soft fade into the page
- Attachment chips in neutral stone (not gold)
- Focus ring muted; send is the only strong accent
- Hint text hidden when empty


## Design R4 — Sidebar & empty state

- Section labels in sentence case, not loud uppercase
- Active chat uses soft surface (not gold wash)
- Unread as a small accent dot (numeric pill when count present)
- New chat / search: transparent, quiet borders
- Empty state: short studio line + secondary hint


## Design R5 — Motion & density

- Messages fade in (no slide/bounce)
- Transitions limited to color/opacity (no `transition: all`)
- Guest banner as a quiet text strip
- Header slightly tighter; icons de-emphasized
- Soft shadows on system banners


## Tools T0–T2 (everyday)

- **T0:** Size limits, status (working/ok/error), health strip on open
- **T1:** Convert / BG remove (before·after) / OCR with **Send to Paul**
- **T2:** PDF→Word with clear errors; Text→Word title + export / send


## Tools T3–T4

- **T3:** Separate Units / Material / Calculator / Weather cards; cm+m+ft; Send to Paul on results
- **T4:** Quiet list-style tool cards with SVG icons
