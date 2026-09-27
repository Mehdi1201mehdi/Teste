// Modèle de données — schéma 5 (fonctions pures, sans DOM ni stockage).
//
// Un signalement (« bon de passage ») garde EXACTEMENT les champs historiques
// qui composent la ligne du message (rue, numero, secteur, wastes, precisions)
// et gagne ce qui permet de le retrouver, de le suivre et de le mesurer :
//
//   id          identifiant interne unique (UUID) — la vraie clé
//   ref         référence lisible « BV-2026-000123 » (compteur de l'appareil)
//   tourId      tournée d'origine
//   date        jour de la tournée (AAAA-MM-JJ) — toujours renseigné
//   createdAt   horodatage de création (null pour les bons antérieurs à v5)
//   updatedAt   dernière modification
//   geo         { lat, lon, acc, source } — source : "gps" | "carte" ; null sinon
//   status      releve | transmis | traite | persistant
//   statusLog   [{ status, at }] — traçabilité des changements de statut
//   note        note interne (jamais envoyée dans le message)
//
// Rien n'est inventé : une information inconnue reste null / vide.

export const SCHEMA = 5;

export const STATUS = {
  releve: { label: "Relevé", hint: "Dans la tournée en cours" },
  transmis: { label: "Transmis", hint: "Rapport envoyé, tournée clôturée" },
  traite: { label: "Traité", hint: "Constaté enlevé lors d'un repassage" },
  persistant: { label: "Toujours présent", hint: "Constaté encore présent lors d'un repassage" },
};
export const STATUS_KEYS = Object.keys(STATUS);
/** Statuts « ouverts » : le dépôt n'a pas été constaté enlevé. */
export const OPEN_STATUS = new Set(["releve", "transmis", "persistant"]);

/** UUID v4 (crypto.randomUUID si disponible, sinon repli). */
export function uuid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Référence lisible : BV-<année>-<compteur sur 6 chiffres>. */
export function formatRef(year, n) {
  return `BV-${year}-${String(n).padStart(6, "0")}`;
}

/** Identifiant de tournée : T-AAAAMMJJ-xxxx (lisible, unique en pratique). */
export function newTourId(dateISO, now = new Date()) {
  const d = (dateISO || now.toISOString().slice(0, 10)).replace(/-/g, "");
  return `T-${d}-${uuid().slice(0, 4)}`;
}

const str = (v) => (v == null ? "" : String(v)).trim();
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const isoOrNull = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

function cleanGeo(g) {
  if (!g || typeof g !== "object") return null;
  const lat = Number(g.lat);
  const lon = Number(g.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const acc = Number(g.acc);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    acc: Number.isFinite(acc) && acc > 0 ? Math.round(acc) : null,
    source: ["gps", "carte"].includes(g.source) ? g.source : "gps",
  };
}

/**
 * Normalise un signalement de n'importe quelle version (v3, v4, v5, import
 * externe) vers le schéma 5. Renvoie null si l'essentiel manque (rue, secteur).
 * `ctx` : { date, tourId, nextRef:() => string, now }
 */
export function normalizeBp(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;
  const rue = str(raw.rue);
  const secteur = str(raw.secteur).toUpperCase();
  if (!rue || !secteur) return null;
  const now = ctx.now || new Date().toISOString();
  const createdAt = isoOrNull(raw.createdAt);
  const status = STATUS_KEYS.includes(raw.status) ? raw.status : ctx.status || "releve";
  const log = Array.isArray(raw.statusLog)
    ? raw.statusLog.filter((e) => e && STATUS_KEYS.includes(e.status)).map((e) => ({ status: e.status, at: isoOrNull(e.at) }))
    : [];
  return {
    id: str(raw.id) || uuid(),
    ref: /^BV-\d{4}-\d{6}$/.test(str(raw.ref)) ? str(raw.ref) : ctx.nextRef ? ctx.nextRef() : "",
    tourId: str(raw.tourId) || ctx.tourId || "",
    date: dateOrNull(raw.date) || ctx.date || (createdAt ? createdAt.slice(0, 10) : null),
    createdAt,
    updatedAt: isoOrNull(raw.updatedAt) || createdAt || now,
    // Champs historiques — la ligne du message en dépend.
    rue,
    numero: str(raw.numero),
    secteur,
    wastes: strList(raw.wastes),
    precisions: strList(raw.precisions),
    geo: cleanGeo(raw.geo),
    status,
    statusLog: log.length ? log : [{ status, at: createdAt }],
    note: str(raw.note).slice(0, 500),
  };
}

/** Changement de statut tracé (renvoie un nouvel objet). */
export function withStatus(bp, status, at = new Date().toISOString()) {
  if (!STATUS_KEYS.includes(status) || bp.status === status) return bp;
  return { ...bp, status, updatedAt: at, statusLog: [...(bp.statusLog || []), { status, at }] };
}

/** Date du passage à un statut donné (dernière occurrence), ou null. */
export function statusDate(bp, status) {
  const e = [...(bp.statusLog || [])].reverse().find((x) => x.status === status);
  return e?.at || null;
}

/** Tournée archivée : forme normalisée (import, restauration). */
export function normalizeTour(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;
  const date = dateOrNull(raw.date);
  const id = str(raw.id) || newTourId(date || undefined);
  const bps = (Array.isArray(raw.bps) ? raw.bps : [])
    .map((b) => normalizeBp(b, { ...ctx, date: date || ctx.date, tourId: id, status: "transmis" }))
    .filter(Boolean);
  if (!bps.length) return null;
  return {
    id,
    v: SCHEMA,
    date: date || bps[0].date,
    startedAt: isoOrNull(raw.startedAt),
    closedAt: isoOrNull(raw.closedAt),
    mailSubject: str(raw.mailSubject),
    mailText: typeof raw.mailText === "string" ? raw.mailText : "",
    mailTo: str(raw.mailTo),
    bps,
  };
}
