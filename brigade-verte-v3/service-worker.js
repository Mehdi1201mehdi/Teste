// Service Worker — installation Android/iPhone + fonctionnement hors connexion.
// Les API externes (WFS secteurs, api-adresse) ne sont jamais mises en cache :
// elles passent directement au réseau et l'application retombe déjà, côté JS,
// sur le secteur embarqué dans data/streets.json si le réseau est indisponible.

const VERSION = "v3.6.1";
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
  "./js/geo.js",
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
  "./suivi/",
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

// HTML/CSS/JS : cache d'abord, uniquement depuis le cache versionné installé
// d'un bloc. Cela garantit que la page et ses scripts sont TOUJOURS de la même
// version — jamais un HTML neuf avec un vieux JavaScript. Les mises à jour
// arrivent par l'installation d'un nouveau service worker (VERSION changée),
// et la page se recharge alors automatiquement (voir app.js).
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(cacheName);
  cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return; // API externes et requêtes non-GET : réseau direct, sans interception.
  }

  if (request.mode === "navigate") {
    // La page /suivi/ est une page autonome : réseau d'abord (pour recevoir
    // les mises à jour), cache en secours (mode terrain hors connexion).
    if (url.pathname.includes("/suivi")) {
      event.respondWith(
        (async () => {
          try {
            const fresh = await fetch(request);
            const cache = await caches.open(SHELL_CACHE);
            cache.put("./suivi/", fresh.clone());
            return fresh;
          } catch (e) {
            return (await caches.match("./suivi/")) || Response.error();
          }
        })(),
      );
      return;
    }
    event.respondWith(
      (async () => (await caches.match("./index.html")) || fetch(request))(),
    );
    return;
  }

  if (url.pathname.includes("/data/")) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
