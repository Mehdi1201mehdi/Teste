// Persistance locale : chaque interaction est enregistrée, pour ne jamais
// perdre une saisie si le téléphone s'éteint ou si l'onglet est fermé.
// La clé et la forme des bons (bps) sont conservées depuis la v3 : les
// tournées en cours sur les téléphones des agents sont reprises telles quelles.

import { nowHM } from "./utils.js";
import { SCHEMA, normalizeBp, formatRef, newTourId } from "./model.js";

export const STORAGE_KEY = "brigade_verte_amiens_v3_pro";

function emptyCurrent() {
  // geo : position de la mesure (GPS ou toucher de carte) — null si rue choisie par recherche.
  return { rue: null, numero: "", secteur: null, secteurAuto: true, precisions: [], precisionCustom: "", wastes: [], geo: null, note: "" };
}

function defaultState() {
  return {
    version: SCHEMA,
    date: "",
    view: "terrain", // "terrain" | "rapport" | "collecte"
    stage: 1, // 1 Lieu · 2 Déchets · 3 Valider
    current: emptyCurrent(),
    bps: [],
    editing: null,
    mailCustom: "",
    mailTo: "", // destinataire(s) du rapport, gardé d'une tournée à l'autre
    tour: null, // { id, startedAt } — tournée en cours (créée au 1er signalement)
    seq: { year: new Date().getFullYear(), n: 0 }, // compteur des références BV-AAAA-NNNNNN
    quarantine: [], // éléments illisibles mis de côté (jamais supprimés en silence)
    prio: null, // pondérations de l'indice de priorité (null = valeurs par défaut)
    gps: true,
    wasteFreq: {}, // { "Matelas": 12, … } — alimente « Les plus fréquents »
    lastSaved: "",
    lastBackup: "", // date ISO de la dernière sauvegarde complète exportée
  };
}

export const state = defaultState();

/** Référence suivante (compteur de l'appareil, remis à 1 chaque année). */
function nextRefOf(st) {
  const year = new Date().getFullYear();
  if (!st.seq || st.seq.year !== year) st.seq = { year, n: 0 };
  st.seq.n += 1;
  return formatRef(year, st.seq.n);
}
export const nextRef = () => nextRefOf(state);

/** Tournée en cours (créée au premier signalement). */
export function ensureTour() {
  if (!state.tour) state.tour = { id: newTourId(state.date || undefined), startedAt: new Date().toISOString() };
  return state.tour;
}
export { emptyCurrent };

/** Met à niveau une sauvegarde ancienne vers le schéma courant, sans rien perdre. */
function migrate(saved) {
  if (!saved || typeof saved !== "object") return null;
  if (!saved.current || typeof saved.current !== "object") saved.current = emptyCurrent();
  const c = saved.current;
  if (!Array.isArray(c.precisions)) c.precisions = [];
  if (!Array.isArray(c.wastes)) c.wastes = [];
  if (typeof c.secteurAuto !== "boolean") c.secteurAuto = true;
  if (!Array.isArray(saved.bps)) saved.bps = [];
  if (!saved.wasteFreq || typeof saved.wasteFreq !== "object") saved.wasteFreq = {};
  if (typeof saved.mailTo !== "string") saved.mailTo = "";

  // v3 → v4 : l'assistant en 5 étapes devient 3 temps + une vue Rapport.
  if ((saved.version || 3) < 4) {
    const step = Number(saved.step) || 1;
    saved.view = step >= 5 ? "rapport" : "terrain";
    saved.stage = step === 3 ? 2 : step === 4 ? 3 : 1;
    delete saved.step;
    // Les BP déjà saisis ont servi à entraîner la liste « fréquents ».
    saved.bps.forEach((b) => (b.wastes || []).forEach((w) => (saved.wasteFreq[w] = (saved.wasteFreq[w] || 0) + 1)));
  }
  // v4 → v5 : chaque bon reçoit un identifiant, une référence, sa date et un
  // statut. L'heure des bons antérieurs n'est pas connue : elle reste vide.
  if (!saved.seq || typeof saved.seq.n !== "number") saved.seq = { year: new Date().getFullYear(), n: 0 };
  if (!saved.tour || typeof saved.tour !== "object" || !saved.tour.id) {
    saved.tour = saved.bps.length ? { id: newTourId(saved.date || undefined), startedAt: null } : null;
  }
  const ctx = { date: saved.date || null, tourId: saved.tour?.id || "", nextRef: () => nextRefOf(saved) };
  // Un élément illisible n'est jamais jeté : il part en quarantaine, conservée
  // sur l'appareil et incluse dans la sauvegarde complète (Réglages).
  const kept = [];
  const quarantine = Array.isArray(saved.quarantine) ? saved.quarantine : [];
  saved.bps.forEach((b) => {
    const n = normalizeBp(b, ctx);
    if (n) kept.push(n);
    else quarantine.push({ at: new Date().toISOString(), raw: b });
  });
  saved.bps = kept;
  saved.quarantine = quarantine.slice(-200);
  if (typeof c.note !== "string") c.note = "";
  if (!("geo" in c)) c.geo = null;
  if (saved.editing != null && !saved.bps[saved.editing]) saved.editing = null;
  if (!["rapport", "collecte", "historique"].includes(saved.view)) saved.view = "terrain";
  if (![1, 2, 3].includes(saved.stage)) saved.stage = 1;
  saved.version = SCHEMA;
  return saved;
}

export function load() {
  try {
    const saved = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    if (saved) Object.assign(state, saved);
  } catch (e) {
    /* stockage indisponible ou corrompu : on repart sur l'état par défaut */
  }
}

let quotaWarned = false;
export function save() {
  try {
    state.lastSaved = nowHM();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    quotaWarned = false;
  } catch (e) {
    const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
    if (quota && !quotaWarned) {
      quotaWarned = true;
      document.dispatchEvent(new CustomEvent("bv:quota"));
    }
  }
}
