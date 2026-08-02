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
