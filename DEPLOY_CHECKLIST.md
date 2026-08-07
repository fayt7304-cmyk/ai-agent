# Deploy checklist — mobile login fix + Google account linking

Code changes are done. These are the manual steps only you can do (dashboard/DNS/account access).

## 1. Add a custom domain for the Worker (fixes "not authenticated" on phone)
In the Cloudflare dashboard:
- Workers & Pages → `mistral-agent-chat` → Settings → Domains & Routes → **Add Custom Domain**
- Enter `api.afmarbre.com` and confirm. Cloudflare will provision the DNS + certificate automatically since `afmarbre.com` is already on your account.

If you'd rather use a different subdomain, that's fine — just also update:
- `app/src/api.ts` → `API_BASE`
- `worker/wrangler.toml` → `GOOGLE_REDIRECT_URI` and `COOKIE_DOMAIN` (keep the leading dot, e.g. `.yourdomain.com`)

## 2. Add the new redirect URI in Google Cloud Console
- Go to your OAuth 2.0 Client ID (APIs & Services → Credentials)
- Under **Authorized redirect URIs**, add:
  `https://api.afmarbre.com/api/auth/google/callback`
- You can leave the old workers.dev one in there too, or remove it once you confirm the new domain works.

## 3. Deploy
```bash
cd worker
npm install
npm run deploy

cd ../app
npm install
npm run build
npx wrangler deploy
```

## 4. Test on your phone
- Open `https://ai.afmarbre.com` in a private/incognito tab (to rule out any old cached cookie state)
- Log in, then send a chat message — this is the step that used to fail with "not authenticated"
- Open Settings → Google account → Connect Google, confirm it shows "Connected" afterward
- Focus a text field and confirm the page no longer zooms in

## What changed and why (quick reference)
- **"Not authenticated" on phone**: the login cookie was cross-site (frontend on `ai.afmarbre.com`, API on an unrelated `*.workers.dev` domain). Mobile browsers frequently block that. Moving the API to `api.afmarbre.com` and setting `COOKIE_DOMAIN=".afmarbre.com"` makes the cookie same-site, which is what phones honor reliably.
- **Page "zoomed in"**: iOS Safari auto-zooms when a focused input's font-size is under 16px, and often doesn't zoom back out. All form controls are now 16px on mobile.
- **Google account linking**: new — Settings now has a Connect/Disconnect control that links your Google account to your existing username/password account (rather than only working at sign-in and possibly creating a duplicate account).

---

# Update — session, voice, RTL and UI pass

## Session no longer depends on cookies
The login screen kept coming back for already-logged-in users because the
session lived only in a cookie set by `api.afmarbre.com`. Browsers that block
cross-site cookies dropped it, so `/api/auth/me` answered 401 on every visit.

The Worker now also returns the session token in the response body
(`session_token`) and, after Google sign-in, in the redirect fragment
(`#session=…`). The frontend stores it and sends
`Authorization: Bearer <token>` on every request, so the session survives
regardless of cookie policy. Cookies still work as before — this is an
additional path, not a replacement.

Nothing to configure. Just redeploy both halves (the Worker must be deployed
too, or the browser will send a Bearer token the old Worker ignores).

## If "the worker doesn't work"
Every request failing usually means nothing is answering at
`https://api.afmarbre.com`. Check:
1. Cloudflare dashboard → Workers & Pages → `mistral-agent-chat` → Settings →
   Domains & Routes → `api.afmarbre.com` is listed and active.
2. `curl -i https://api.afmarbre.com/api/auth/me` returns JSON (a 401 is fine —
   it means the Worker is alive). An HTML error page or a Cloudflare error
   means the domain isn't routed to the Worker.
3. Until the domain is attached you can point the frontend straight at the
   workers.dev URL without editing code:
   `echo 'VITE_API_BASE=https://mistral-agent-chat.<your-subdomain>.workers.dev' > app/.env`
   then rebuild. (In a live browser: `localStorage.setItem("api-base", "…")`.)

## High-quality voice ("Voice service error 400 … code 7000")
`code 7000 / "no route for that URI"` came from the Cloudflare API: the default
model id was `@cf/elevenlabs/eleven-multilingual-v2`, and **there is no
ElevenLabs model on Workers AI**, so the URL pointed at nothing. Fixed:
- Workers AI now defaults to `@cf/myshell-ai/melotts` (a real TTS model) and
  sends the payload that model expects.
- Secrets are trimmed — a trailing newline in `CLOUDFLARE_ACCOUNT_ID` produced
  the exact same 7000 error.
- A misconfigured deployment now answers `501` and the app quietly falls back
  to the device voice instead of showing a raw Cloudflare error mid-chat.

For the best quality, use ElevenLabs directly (it is tried first when present):
```bash
cd worker
npx wrangler secret put ELEVENLABS_API_KEY
```
Optional Workers AI path instead:
```bash
npx wrangler secret put CLOUDFLARE_AI_TOKEN     # token with Workers AI permission
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID   # no trailing spaces/newlines
# optional: TTS_MODEL to override @cf/myshell-ai/melotts
```
With neither set, "high-quality voice" falls back to the browser voice silently.

---

# High-quality TTS (v8.1)

`/api/tts` returns **501** until at least one path is configured. The app then falls back to the browser voice.

## Option A — ElevenLabs (best quality)

1. Create a key at https://elevenlabs.io  
2. On the machine that deploys the Worker:

```bash
cd worker
npx wrangler secret put ELEVENLABS_API_KEY
# optional:
# npx wrangler secret put ELEVENLABS_MODEL
# value e.g. eleven_multilingual_v2
```

3. Redeploy: `npx wrangler deploy`  
4. In the app: Settings → General → turn **High-quality voice** on.

Voice styles map to ElevenLabs IDs in `app/src/lib/speech.ts` (`VOICE_IDS`).

## Option B — Workers AI only (no ElevenLabs bill)

`wrangler.toml` already has:

```toml
[ai]
binding = "AI"
```

That alone is enough for the binding path. Models tried in order:

1. `TTS_MODEL` if set  
2. `@cf/myshell-ai/melotts`  
3. `@cf/deepgram/aura-2-en` or `aura-2-es`  
4. `@cf/deepgram/aura-1`

Optional REST fallback (if the binding is missing on some plans):

```bash
npx wrangler secret put CLOUDFLARE_AI_TOKEN    # Workers AI permission
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID  # no trailing newline
# optional:
# npx wrangler secret put TTS_MODEL
# value: @cf/myshell-ai/melotts
```

**Do not** use `@cf/elevenlabs/...` — that model does not exist on Workers AI (route error 7000).

## Local files (paths that were easy to miss)

| Path | Purpose |
|------|---------|
| `app/.env` | Copy from `app/.env.example` — set `VITE_API_BASE` before `npm run build` |
| `app/.env.example` | Template for frontend API origin |
| `worker/.dev.vars` | Copy from `worker/.dev.vars.example` — secrets for `wrangler dev` |
| `worker/.dev.vars.example` | Template including TTS secrets |
| `worker/wrangler.toml` | `[ai]` binding, D1, public `[vars]` |
| `worker/src/index.ts` | `handleTts` — ElevenLabs → MeloTTS → Aura |
| `app/src/lib/speech.ts` | Client TTS + `VOICE_IDS` + fallback delays |
| `app/src/api.ts` | `API_BASE` resolution (`VITE_API_BASE` / `localStorage api-base`) |

## Quick verify

```bash
# Worker alive
curl -i https://api.afmarbre.com/api/auth/me

# After login, high-quality voice should return audio/mpeg (not 501)
# Check Worker logs:
npx wrangler tail
```

If you still see 501 with Option B, open the Cloudflare dashboard → Workers AI and confirm the account has Workers AI enabled and usage is allowed.
