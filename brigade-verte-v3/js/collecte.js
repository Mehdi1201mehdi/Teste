// Jour de collecte — règles et données, sans DOM.
//
// Source : le service public d'Amiens Métropole (formulaire « Mon jour de
// collecte »), interrogé via notre relais /api/collecte, À LA DEMANDE : une
// requête par rue cherchée, jamais d'aspiration. Les réponses sont gardées
// 7 jours sur l'appareil : une rue déjà consultée reste disponible hors ligne.

const CACHE_KEY = "bv_collecte_v1";
const CACHE_MAX = 120; // rues gardées (≈ quelques centaines de Ko au plus)
const FRESH_MS = 7 * 24 * 3600 * 1000;
export const OFFICIAL_URL = "https://www.amiens.fr/Vivre-a-Amiens/Prevention-et-gestion-des-dechets/Mon-jour-de-collecte";

/* ─────────────── Relais ─────────────── */

/** Même origine sur Cloudflare Pages ; sinon (GitHub Pages) le relais Cloudflare. */
export function apiBase(loc = window.location) {
  if (/\.pages\.dev$/.test(loc.hostname)) return "";
  return "https://brigade-verte.pages.dev";
}

/* ─────────────── Noms de voies ─────────────── */

/** MAJUSCULES, sans accents ni ponctuation — la forme du fichier d'Amiens Métropole. */
export function normVoie(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\bST\b/g, "SAINT")
    .replace(/\bSTE\b/g, "SAINTE")
    .trim();
}

// Types de voie : ils distinguent « Rue Jean Racine » de « Hameau Jean Racine ».
const TYPES = new Set(["RUE", "AVENUE", "BOULEVARD", "PLACE", "ALLEE", "IMPASSE", "CHEMIN", "ROUTE", "SQUARE", "QUAI", "PASSAGE", "SENTIER", "CITE", "RESIDENCE", "RUELLE", "ESPLANADE", "PARVIS", "COUR", "VOIE", "HAMEAU", "PLACETTE", "PROMENADE", "MAIL", "ROND", "POINT", "PASSERELLE", "CLOS", "VILLA", "LOTISSEMENT", "PARC"]);
// Mots vides : « Rue du Longuet » = « RUE DE LONGUET ».
const ARTICLES = new Set(["DU", "DE", "DES", "LA", "LE", "LES", "D", "L", "AU", "AUX", "ET", "EN", "SUR", "SOUS"]);
// Mots trop courants pour interroger le service (trop de résultats, ou aucun).
const WEAK = new Set(["SAINT", "SAINTE", "PROLONGE", "PROLONGEE", "GRAND", "GRANDE", "PETIT", "PETITE", "NOUVELLE", "VIEUX", "VIEILLE", "HAUT", "BAS", "NORD", "SUD", "EST", "OUEST", "GENERAL", "DOCTEUR", "PRESIDENT", "MARECHAL"]);

/** Clé de comparaison : type + mots significatifs (sans articles). */
export function voieKey(s) {
  return normVoie(s)
    .split(" ")
    .filter((w) => w && !ARTICLES.has(w))
    .join(" ");
}

/** Mots significatifs sans le type de voie (pour proposer les voies voisines). */
function coreWords(s) {
  return voieKey(s)
    .split(" ")
    .filter((w) => !TYPES.has(w));
}

/**
 * Mot à envoyer au service : le plus distinctif du nom (le service d'Amiens
 * est capricieux avec les noms complets : « saint leu » ne renvoie rien).
 */
export function queryWords(name) {
  const core = coreWords(name);
  // Plus long d'abord ; à égalité, le plus à droite (souvent le nom propre :
  // « Jules BARNI »).
  const rank = (list) =>
    list
      .map((w, i) => ({ w, i }))
      .sort((a, b) => b.w.length - a.w.length || b.i - a.i)
      .map((o) => o.w);
  const strong = rank(core.filter((w) => !WEAK.has(w) && !/^\d+$/.test(w)));
  const words = strong.length ? strong : rank(core);
  return (words.length ? words : [normVoie(name)]).map((w) => w.toLowerCase());
}
export const queryWord = (name) => queryWords(name)[0];

/**
 * Parmi les lignes reçues, celles de la voie cherchée.
 * → { exact: rows[] } si trouvée ; sinon { near: [noms de voies proches] }.
 */
export function matchVoie(rows, name) {
  const key = voieKey(name);
  const exact = rows.filter((r) => voieKey(r.voie) === key);
  if (exact.length) return { exact, voie: exact[0].voie };
  const core = coreWords(name).join(" ");
  const near = [...new Set(rows.map((r) => r.voie))].filter((v) => coreWords(v).join(" ") === core);
  return { exact: [], near };
}

/* ─────────────── Numéros ─────────────── */

/** « 12 », « 12 bis », « 12B » → { n: "12", x: "B" }. */
export function parseNumero(s) {
  const m = String(s || "").trim().match(/^(\d+)\s*([a-zA-Z]*)/);
  if (!m) return null;
  const suf = m[2].toLowerCase();
  const x = !suf ? "" : suf === "bis" ? "B" : suf === "ter" ? "T" : suf === "quater" ? "Q" : suf[0].toUpperCase();
  return { n: String(+m[1]), x };
}

/** Ligne exacte d'un numéro (extension comprise ; repli sur le numéro seul). */
export function findNumero(rows, numero) {
  const p = parseNumero(numero);
  if (!p) return null;
  return rows.find((r) => String(+r.n) === p.n && (r.x || "") === p.x) || rows.find((r) => String(+r.n) === p.n) || null;
}

/**
 * Regroupe les numéros d'une voie par calendrier identique, en plages lisibles
 * côté impair / côté pair : [{ om, tri, ranges: ["impairs 1 → 45", "pairs 2 → 30"], count }].
 */
export function groupBySchedule(rows) {
  const sorted = rows
    .filter((r) => r.n !== "" && !isNaN(+r.n))
    .map((r) => ({ ...r, num: +r.n }))
    .sort((a, b) => a.num - b.num || (a.x || "").localeCompare(b.x || ""));
  const sig = (r) => r.om + "|" + r.tri;
  const groups = new Map();
  for (const side of [1, 0]) {
    const list = sorted.filter((r) => r.num % 2 === side);
    let run = null;
    const flush = () => {
      if (!run) return;
      const g = groups.get(run.sig) || { om: run.om, tri: run.tri, ranges: [], count: 0 };
      const label = side ? "impairs" : "pairs";
      g.ranges.push(run.count === 1 ? `n° ${run.from}${run.x ? " " + run.x : ""}` : `${label} ${run.from} → ${run.to}`);
      g.count += run.count;
      groups.set(run.sig, g);
      run = null;
    };
    for (const r of list) {
      if (run && run.sig === sig(r)) {
        run.to = r.num;
        run.count++;
      } else {
        flush();
        run = { sig: sig(r), om: r.om, tri: r.tri, from: r.num, to: r.num, x: r.x || "", count: 1 };
      }
    }
    flush();
  }
  // Voies sans numéros (ou communes) : une seule ligne.
  if (!groups.size && rows.length) groups.set("x", { om: rows[0].om, tri: rows[0].tri, ranges: [], count: rows.length });
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/* ─────────────── Calendrier ─────────────── */

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/**
 * « Lundi + Jeudi », « Lundi des semaines paires », « Vendredi semaine paire »
 * → { days: [1, 4], parity: null | "paire" | "impaire" }.
 */
export function parseSchedule(s) {
  const t = String(s || "").toLowerCase();
  const days = JOURS.map((j, i) => (new RegExp(`\\b${j}\\b`).test(t) ? i : -1)).filter((i) => i >= 0);
  const parity = /impaire/.test(t) ? "impaire" : /paire/.test(t) ? "paire" : null;
  return { days, parity };
}

/** Numéro de semaine ISO 8601. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

// Seuls jours fériés NON collectés (règle d'Amiens Métropole).
const isOffDay = (d) => (d.getMonth() === 0 && d.getDate() === 1) || (d.getMonth() === 4 && d.getDate() === 1) || (d.getMonth() === 11 && d.getDate() === 25);

/**
 * Prochain passage à partir de `from` (inclus), report des jours fériés compris :
 * Amiens → le mercredi de la même semaine ; autres communes → le lendemain.
 * → { date, moved: bool } ou null si le calendrier est illisible.
 */
export function nextPickup(schedule, from = new Date(), { commune = false } = {}) {
  const { days, parity } = parseSchedule(schedule);
  if (!days.length) return null;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 21; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (!days.includes(d.getDay())) continue;
    if (parity && (isoWeek(d) % 2 === 0 ? "paire" : "impaire") !== parity) continue;
    if (!isOffDay(d)) return { date: d, moved: false };
    const m = new Date(d);
    if (commune) m.setDate(d.getDate() + 1);
    else m.setDate(d.getDate() + (3 - d.getDay())); // mercredi de la même semaine
    if (m >= start) return { date: m, moved: true };
  }
  return null;
}

/** « aujourd'hui », « demain », « jeudi 26/09 ». */
export function relDay(date, now = new Date()) {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date - a) / 86400000);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return "demain";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${JOURS[date.getDay()]} ${dd}/${mm}`;
}

/** Parité de la semaine en cours (affichée : l'agent peut vérifier). */
export const weekParity = (d = new Date()) => (isoWeek(d) % 2 === 0 ? "paire" : "impaire");

/* ─────────────── Cache local + requête ─────────────── */

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function writeCache(c) {
  try {
    const keys = Object.keys(c);
    if (keys.length > CACHE_MAX) {
      keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0)).slice(0, keys.length - CACHE_MAX).forEach((k) => delete c[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* stockage plein ou bloqué : on s'en passe */
  }
}

/** Réponse en cache (même périmée), ou null. */
export function cached(q) {
  const hit = readCache()[q.toLowerCase()];
  return hit ? { rows: hit.rows, at: hit.t, stale: Date.now() - hit.t > FRESH_MS, fromCache: true } : null;
}

/**
 * Lignes d'une recherche (mot de voie ou « Commune - commune »).
 * Cache frais → immédiat. Sinon réseau (délai 12 s) ; en échec, cache périmé
 * s'il existe. Lève une Error au message rédigé pour l'agent.
 */
export async function fetchRows(q, { force = false, fetchImpl = fetch } = {}) {
  const key = q.toLowerCase();
  const hit = cached(key);
  if (hit && !hit.stale && !force) return hit;
  if (!navigator.onLine && hit) return hit;
  if (!navigator.onLine) throw new Error("Hors connexion — cette rue n'a pas encore été consultée sur ce téléphone.");
  try {
    const r = await fetchImpl(`${apiBase()}/api/collecte?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout?.(12000) });
    if (!r.ok) throw new Error(r.status >= 500 ? "Le service d'Amiens Métropole ne répond pas pour l'instant." : "Recherche refusée.");
    const data = await r.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const c = readCache();
    c[key] = { t: Date.now(), rows };
    writeCache(c);
    return { rows, at: Date.now(), stale: false, fromCache: false };
  } catch (e) {
    if (hit) return { ...hit, offlineFallback: true };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new Error("Amiens Métropole met trop de temps à répondre — réessayez.");
    throw e instanceof Error && /Amiens|refusée|Hors/.test(e.message) ? e : new Error("Service de collecte injoignable — vérifiez la connexion.");
  }
}

/** Collecte d'une rue de notre liste (et, si donné, d'un numéro précis). */
export async function lookupStreet(name, numero = "", opts) {
  // 1er mot distinctif ; si le service ne connaît pas la voie sous ce mot
  // (il est capricieux), une seule relance avec le mot suivant.
  const words = queryWords(name).slice(0, 2);
  let res, m;
  for (const w of words) {
    res = await fetchRows(w, opts);
    m = matchVoie(res.rows, name);
    if (m.exact.length || m.near.length) break;
  }
  const row = m.exact.length && numero ? findNumero(m.exact, numero) : null;
  return { ...res, ...m, row };
}

/** Collecte d'une commune de la métropole (hors Amiens). */
export async function lookupCommune(commune, opts) {
  const res = await fetchRows(`${commune.trim()} - commune`, opts);
  return { ...res, exact: res.rows.slice(0, 1), commune: true };
}

/** Forme courte pour la carte « lieu » : « mar. + ven. », « lun. (sem. paires) ». */
export function shortSchedule(s) {
  const { days, parity } = parseSchedule(s);
  if (!days.length) return String(s || "—");
  const abbr = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const txt = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)) ? "lun. → ven." : days.map((d) => abbr[d]).join(" + ");
  return parity ? `${txt} (sem. ${parity}s)` : txt;
}

/** Calendrier applicable à une adresse (ligne exacte, ou rue au calendrier unique). */
export function scheduleFor(res) {
  if (res.row) return res.row;
  if (!res.exact?.length) return null;
  return groupBySchedule(res.exact).length === 1 ? res.exact[0] : null;
}
