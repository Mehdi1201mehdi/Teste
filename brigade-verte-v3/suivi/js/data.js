// Données rues + secteurs (depuis data/streets.json, issu des API) et
// récupération des numéros officiels d'une rue (Base Adresse Nationale).
// Aucune rue codée en dur : tout vient du jeu de données partagé.

export const SECTEURS = ["CENTRE", "NORD", "SUD", "EST", "OUEST"];

export const SECTOR_META = {
  CENTRE: { label: "Centre", color: "#7c5cff", emoji: "🏛️" },
  NORD:   { label: "Nord",   color: "#16a34a", emoji: "⬆️" },
  SUD:    { label: "Sud",    color: "#f59e0b", emoji: "⬇️" },
  EST:    { label: "Est",    color: "#ef4444", emoji: "➡️" },
  OUEST:  { label: "Ouest",  color: "#2563eb", emoji: "⬅️" },
};

// Boutons rapides d'anomalie = catégories terrain demandées.
export const OBJETS = [
  "Bac OM", "Bac Jaune", "Conteneur Veolia", "Mobilier Commerce",
  "Objet", "Encombrant", "Dépôt", "Autre",
];

const ADRESSE_API = "https://api-adresse.data.gouv.fr/search/";
const AMIENS_CITYCODE = "80021";

let RUES = []; // [{rue, lon, lat, secteur}]

export async function loadStreets() {
  try {
    const r = await fetch("../data/streets.json");
    const list = await r.json();
    RUES = Array.isArray(list) ? list.filter((x) => x && x.rue && x.secteur) : [];
  } catch (e) {
    RUES = [];
  }
  RUES.sort((a, b) => a.rue.localeCompare(b.rue, "fr"));
  return RUES;
}

export function allStreets() {
  return RUES;
}
export function streetsOfSector(sec) {
  return RUES.filter((r) => r.secteur === sec);
}
export function sectorCounts() {
  const c = {};
  SECTEURS.forEach((s) => (c[s] = 0));
  RUES.forEach((r) => { if (c[r.secteur] != null) c[r.secteur]++; });
  return c;
}

export function norm(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function numKey(v) {
  const m = String(v).match(/\d+/);
  return m ? parseInt(m[0], 10) : 1e9;
}

/** Recherche floue tolérante (rue et/ou secteur). */
export function searchStreets(query, limit = 40) {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);
  const scored = [];
  for (const r of RUES) {
    const hay = norm(r.rue);
    let score = 0, ok = true;
    for (const t of terms) {
      const i = hay.indexOf(t);
      if (i === -1) { ok = false; break; }
      score += i === 0 ? 3 : 1;
    }
    if (ok) scored.push({ r, score: score - hay.length * 0.001 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.r);
}

function baseName(name) {
  return name.replace(/\(.*?\)/g, "").trim();
}

/**
 * Numéros officiels d'une rue à Amiens via la Base Adresse Nationale.
 * Retourne un tableau trié de chaînes, ou null si le réseau est indisponible.
 */
export async function fetchHouseNumbers(name) {
  const q = baseName(name);
  const target = norm(q);
  try {
    const url = `${ADRESSE_API}?q=${encodeURIComponent(q)}&citycode=${AMIENS_CITYCODE}` +
      `&type=housenumber&autocomplete=0&limit=100`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const seen = new Set();
    const out = [];
    for (const f of j.features || []) {
      const p = f.properties || {};
      if (!p.housenumber) continue;
      if (norm(p.street || p.name).indexOf(target) === -1) continue;
      const k = norm(p.housenumber);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(String(p.housenumber));
    }
    out.sort((a, b) => numKey(a) - numKey(b) || a.localeCompare(b, "fr"));
    return out;
  } catch (e) {
    return null;
  }
}
