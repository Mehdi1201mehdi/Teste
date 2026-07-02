// Service Worker — installation Android/iPhone + fonctionnement hors connexion.
// Les API externes (WFS secteurs, api-adresse) ne sont jamais mises en cache :
// elles passent directement au réseau et l'application retombe déjà, côté JS,
// sur le secteur embarqué dans data/streets.json si le réseau est indisponible.

const VERSION = "v3.0.0";
const SHELL_CACHE = `brigade-verte-shell-${VERSION}`;
const DATA_CACHE = `brigade-verte-data-${VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/variables.css",
  "./css/base.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/mobile.css",
  "./css/desktop.css",
  "./css/animations.css",
  "./js/app.js",
  "./js/router.js",
  "./js/storage.js",
  "./js/api.js",
  "./js/streets.js",
  "./js/sectors.js",
  "./js/waste.js",
  "./js/bp.js",
  "./js/mail.js",
  "./js/ui.js",
  "./js/search.js",
  "./js/components.js",
  "./js/utils.js",
  "./assets/logo/logo.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

const DATA_ASSETS = ["./data/streets.json", "./data/waste.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(SHELL_ASSETS);
      const data = await caches.open(DATA_CACHE);
      await data.addAll(DATA_ASSETS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return; // API externes et requêtes non-GET : réseau direct, sans interception.
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (url.pathname.includes("/data/")) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});
