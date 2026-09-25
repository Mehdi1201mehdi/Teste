// Service Worker — installation Android/iPhone + fonctionnement hors connexion.
// Les API externes (WFS secteurs, api-adresse) ne sont jamais mises en cache :
// elles passent directement au réseau et l'application retombe déjà, côté JS,
// sur le secteur embarqué dans data/streets.json si le réseau est indisponible.

const VERSION = "v4.4.0";
const SHELL_CACHE = `brigade-verte-shell-${VERSION}`;
const DATA_CACHE = `brigade-verte-data-${VERSION}`;
// Tuiles du Plan IGN : cache persistant entre versions, borné (~700 tuiles ≈ 20 Mo).
// Les rues déjà vues restent affichées hors connexion.
const TILE_CACHE = "brigade-verte-tiles-ign";
const TILE_MAX = 700;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/vendor/leaflet.css",
  "./css/tokens.css",
  "./css/base.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/map.css",
  "./css/animations.css",
  "./css/splash.css",
  "./js/vendor/leaflet.js",
  "./js/app.js",
  "./js/api.js",
  "./js/bp.js",
  "./js/collecte.js",
  "./js/collecteView.js",
  "./js/components.js",
  "./js/composer.js",
  "./js/geo.js",
  "./js/icons.js",
  "./js/mail.js",
  "./js/map.js",
  "./js/report.js",
  "./js/router.js",
  "./js/search.js",
  "./js/sectors.js",
  "./js/splash.js",
  "./js/storage.js",
  "./js/streets.js",
  "./js/ui.js",
  "./js/utils.js",
  "./js/waste.js",
  "./assets/logo/logo.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/fonts/BricolageGrotesque-var.woff2",
  "./assets/fonts/InstrumentSans-var.woff2",
  "./assets/fonts/JetBrainsMono-500.woff2",
  "./suivi/",
  "./suivi/index.html",
];

const DATA_ASSETS = ["./data/streets.json", "./data/waste.json", "./data/quartiers.geojson", "./data/secteurs.geojson"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // cache: "reload" : on télécharge la version publiée, jamais une copie du
      // cache HTTP du navigateur (GitHub Pages sert ses fichiers avec 10 min de
      // cache) — sinon une nouvelle version pourrait embarquer d'anciens fichiers.
      const fresh = (list) => list.map((url) => new Request(url, { cache: "reload" }));
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(fresh(SHELL_ASSETS));
      const data = await caches.open(DATA_CACHE);
      await data.addAll(fresh(DATA_ASSETS));
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
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE && key !== TILE_CACHE)
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

async function tileCacheFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Uniquement des réponses CORS lisibles (jamais d'opaques : elles gonflent le quota).
    if (response.ok && response.type === "cors") {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      if (keys.length > TILE_MAX) {
        await Promise.all(keys.slice(0, keys.length - TILE_MAX).map((k) => cache.delete(k)));
      }
    }
    return response;
  } catch (e) {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === "GET" && url.hostname === "data.geopf.fr" && url.searchParams.get("REQUEST") === "GetTile") {
    event.respondWith(tileCacheFirst(request));
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return; // API externes et requêtes non-GET : réseau direct, sans interception.
  }
  // Relais jour de collecte (/api/…) : jamais servi depuis le cache de l'app —
  // l'application gère elle-même son cache de 7 jours.
  if (url.pathname.includes("/api/")) return;

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
