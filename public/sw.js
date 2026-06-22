// ReadWise Service Worker
// Strategy:
//   - Cache-first for versioned static assets (/_next/static/**)
//   - Network-first for everything else
//   - Offline fallback (/offline.html) for failed HTML navigations
//   - API routes are always network-only (never cache authenticated responses)
//   - /reader/* paths: when offline, serve /offline-reader.html (which reads
//     article content from IndexedDB if the user downloaded it — #117)

const CACHE_NAME = "readwise-v2";

// Pre-cache the offline fallbacks on install so they're always available.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(["/offline.html", "/offline-reader.html"]))
      .then(() => self.skipWaiting()),
  );
});

// Activate: claim clients and remove stale caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Paths that render authenticated, user-specific SSR content.
// These must never be cached to prevent private data leaking to other users
// on shared devices (e.g. family tablet, school computer, library terminal).
const AUTH_PATHS = [
  "/dashboard",
  "/reader",
  "/study",
  "/browse",
  "/notes",
  "/progress",
  "/lists",
  "/settings",
  "/admin",
  "/tags",
  "/onboarding",
  "/profile",
  "/forbidden",
  "/import",
  "/welcome",
];

/** Returns true when the pathname belongs to a session-gated area. */
function isAuthenticatedPath(pathname) {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin GET requests.
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  // API routes: network-only. Never cache authenticated responses.
  if (url.pathname.startsWith("/api/")) {
    return; // let the browser handle it
  }

  // Next.js RSC/data prefetch routes: network-only.
  if (url.pathname.startsWith("/_next/data/")) {
    return;
  }

  // Versioned static assets (content-hashed): cache-first, then network.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, res.clone()));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Public static files (/icons/**, /icon.svg, /offline.html, etc.): cache-first.
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/offline.html" ||
    url.pathname === "/offline-reader.html" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, res.clone()));
            }
            return res;
          }),
      ),
    );
    return;
  }

// HTML navigations: network-first, offline fallback on failure.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache public/unauthenticated pages (marketing, sign-in, offline).
          // Authenticated paths (dashboard, reader, study, etc.) must NOT be cached
          // to prevent private SSR content leaking to other users on shared devices.
          if (res.ok && res.status === 200 && !isAuthenticatedPath(url.pathname)) {
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, res.clone()));
          }
          return res;
        })
        .catch(() => {
          // For /reader/* paths when offline: serve the standalone offline reader
          // which reads article content from IndexedDB (if user downloaded it).
          if (url.pathname.startsWith("/reader/")) {
            return (
              caches.match("/offline-reader.html") ??
              caches.match("/offline.html") ??
              new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              })
            );
          }
          return (
            caches.match(request) ??
            caches.match("/offline.html") ??
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }),
    );
    return;
  }
});

// ---------------------------------------------------------------------------
// Web Push handlers — SRS review reminders
// ---------------------------------------------------------------------------

/**
 * push event: display the notification sent by the server.
 * Payload JSON shape: { title, body, url?, icon? }
 */
self.addEventListener("push", (event) => {
  let data = { title: "ReadWise", body: "You have words to review!", url: "/study" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    // malformed payload — use defaults
  }

  const options = {
    body: data.body,
    icon: data.icon ?? "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url ?? "/study" },
    actions: [{ action: "open", title: "Review now" }],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options),
  );
});

/**
 * notificationclick: focus the app (or open a new tab) and navigate to /study.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/study";
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Prefer an already-open ReadWise window.
        for (const client of clients) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        // No existing window — open a new one.
        if (self.clients.openWindow) return self.clients.openWindow(fullUrl);
      }),
  );
});
