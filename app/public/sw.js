// Paul PWA shell — v4 (10.4)
// Caches the app shell for offline launch. Never caches API/chat data.
const CACHE_NAME = "paul-shell-v4";
const OFFLINE_URL = "/offline.html";
const SHELL_URLS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_URLS.map((u) =>
          cache.add(u).catch(() => {
            /* missing asset is non-fatal */
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, offline page fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(event.request);
          if (resp && resp.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, resp.clone()).catch(() => {});
          }
          return resp;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match("/")) ||
            (await cache.match(OFFLINE_URL)) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      try {
        const resp = await fetch(event.request);
        if (resp && resp.ok && resp.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, resp.clone()).catch(() => {});
        }
        return resp;
      } catch {
        return (
          cached ||
          (await caches.match(OFFLINE_URL)) ||
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
        );
      }
    })()
  );
});

// Optional: show notification when client posts a message (browser notifications already in app)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});
