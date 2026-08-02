// Minimal service worker: just enough to make the app installable and
// keep the app shell available offline. It does NOT cache API responses —
// chat data always comes fresh from the Worker.
//
// v2: the old fetch handler could resolve respondWith() with `undefined`
// (when nothing was cached yet AND the network call failed), which is what
// caused the "Failed to convert value to 'Response'" console errors. It also
// intercepted cross-origin requests (Cloudflare's own beacon/zaraz calls),
// which is where the "Response body is already used" clone errors came
// from. This version only touches same-origin GETs and always resolves to
// a real Response.
const CACHE_NAME = "agent-shell-v2";
const SHELL_URLS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept API calls — always go to the network for those.
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  // Don't touch cross-origin requests (analytics beacons, fonts, etc.) —
  // caching/cloning those isn't our job and it's what caused the
  // "Response body is already used" errors.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      try {
        const resp = await fetch(event.request);
        // Only cache successful, same-origin ("basic") responses.
        if (resp && resp.ok && resp.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, resp.clone()).catch(() => {});
        }
        return resp;
      } catch {
        // Offline / network failure: fall back to cache, and only ever
        // resolve with a real Response (never undefined).
        return cached || Response.error();
      }
    })()
  );
});
