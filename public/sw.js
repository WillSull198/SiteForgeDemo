const CACHE_NAME = "siteforge-shell-v3";
const APP_SHELL = ["/", "/index.html", "/offline.html", "/manifest.webmanifest", "/siteforge-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_SITEFORGE_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  const networkFirst = (fallbackToShell = false) =>
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request.mode === "navigate" ? "/index.html" : request, clone));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          return fallbackToShell ? caches.match("/index.html").then((shell) => shell || caches.match("/offline.html")) : Response.error();
        }),
      );

  const cacheFirst = () =>
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
    });

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(true));
    return;
  }

  if (url.origin === self.location.origin) {
    if (request.destination === "script" || url.pathname.endsWith(".js")) {
      event.respondWith(networkFirst());
      return;
    }
    if (["image", "font", "manifest"].includes(request.destination) || /\.(svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname)) {
      event.respondWith(cacheFirst());
      return;
    }
    event.respondWith(networkFirst());
  }
});
