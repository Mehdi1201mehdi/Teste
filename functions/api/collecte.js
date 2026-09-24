// Relais « jour de collecte » — Cloudflare Pages Function : GET /api/collecte?q=…
//
// Le formulaire officiel (amiens.fr › Mon jour de collecte) interroge un service
// JSON public, sans compte. Il n'autorise pas les appels depuis un autre site
// (pas d'en-tête CORS) : ce relais fait la même requête côté serveur, À LA
// DEMANDE d'un agent (jamais d'aspiration en masse — robots.txt l'interdit),
// met la réponse en cache 24 h, et ne renvoie que les champs utiles.
//
// Aucune donnée personnelle : la requête ne contient qu'un nom de rue ou de
// commune. Rien n'est journalisé ici.

const UPSTREAM = "https://www.amiens.fr/autocomplete/get-datas/(node)/65767?rue=";
const ALLOWED_ORIGINS = [
  /^https:\/\/mehdi1201mehdi\.github\.io$/,
  /^https:\/\/([a-z0-9-]+\.)?brigade-verte\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
const TTL = 86400; // 24 h : les tournées changent rarement, amiens.fr est ménagé
const MAX_ROWS = 3000;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function json(data, status, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" },
    });
  }
  if (request.method !== "GET") return json({ error: "Méthode non autorisée." }, 405, cors);

  const q = (new URL(request.url).searchParams.get("q") || "").normalize("NFC").trim().replace(/\s+/g, " ");
  // Un nom de voie ou « Commune - commune » : lettres, chiffres, espaces, tirets, apostrophes.
  if (q.length < 3 || q.length > 80 || !/^[\p{L}\p{N} '’\-.]+$/u.test(q)) {
    return json({ error: "Recherche invalide." }, 400, cors);
  }

  const cacheKey = new Request("https://cache.brigade-verte.internal/collecte?q=" + encodeURIComponent(q.toLowerCase()));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  try {
    const hit = cache && (await cache.match(cacheKey));
    if (hit) {
      return new Response(hit.body, {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${TTL}`, "X-Cache": "HIT", ...cors },
      });
    }
  } catch {
    /* cache indisponible : on interroge directement */
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM + encodeURIComponent(q), {
      headers: { Accept: "application/json", "User-Agent": "BrigadeVerte-Amiens/1.0 (outil terrain, recherche a la demande)" },
      signal: AbortSignal.timeout(9000),
      cf: { cacheTtl: TTL, cacheEverything: true },
    });
  } catch {
    return json({ error: "Le service d'Amiens Métropole ne répond pas." }, 504, cors);
  }
  if (!upstream.ok) return json({ error: "Service d'Amiens Métropole indisponible.", status: upstream.status }, 502, cors);

  let raw;
  try {
    raw = await upstream.json();
  } catch {
    return json({ error: "Réponse d'Amiens Métropole illisible." }, 502, cors);
  }

  const rows = (Array.isArray(raw) ? raw : []).slice(0, MAX_ROWS).map((r) => ({
    n: String(r.NUMERO ?? "").trim(),
    x: String(r.EXTENSION ?? "").trim(),
    voie: String(r.voie ?? "").trim(),
    ville: String(r.ville ?? "").trim(),
    om: String(r.om_jour ?? "").trim(),
    tri: String(r.om_tri ?? "").trim(),
  }));
  const body = JSON.stringify({ q, at: new Date().toISOString(), rows });

  if (cache) {
    const stored = new Response(body, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${TTL}` },
    });
    context.waitUntil?.(cache.put(cacheKey, stored).catch(() => {}));
  }
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Cache": "MISS", ...cors },
  });
}
