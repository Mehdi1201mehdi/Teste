// Persistance locale : chaque interaction est enregistrée, pour ne jamais
// perdre une saisie si le téléphone s'éteint ou si l'onglet est fermé.
// La clé et la forme des bons (bps) sont conservées depuis la v3 : les
// tournées en cours sur les téléphones des agents sont reprises telles quelles.

import { nowHM } from "./utils.js";

export const STORAGE_KEY = "brigade_verte_amiens_v3_pro";
const SCHEMA = 4;

function emptyCurrent() {
  return { rue: null, numero: "", secteur: null, secteurAuto: true, precisions: [], precisionCustom: "", wastes: [] };
}

function defaultState() {
  return {
    version: SCHEMA,
    date: "",
    view: "terrain", // "terrain" | "rapport"
    stage: 1, // 1 Lieu · 2 Déchets · 3 Valider
    current: emptyCurrent(),
    bps: [],
    editing: null,
    mailCustom: "",
    gps: true,
    wasteFreq: {}, // { "Matelas": 12, … } — alimente « Les plus fréquents »
    lastSaved: "",
  };
}

export const state = defaultState();
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

  // v3 → v4 : l'assistant en 5 étapes devient 3 temps + une vue Rapport.
  if ((saved.version || 3) < 4) {
    const step = Number(saved.step) || 1;
    saved.view = step >= 5 ? "rapport" : "terrain";
    saved.stage = step === 3 ? 2 : step === 4 ? 3 : 1;
    delete saved.step;
    // Les BP déjà saisis ont servi à entraîner la liste « fréquents ».
    saved.bps.forEach((b) => (b.wastes || []).forEach((w) => (saved.wasteFreq[w] = (saved.wasteFreq[w] || 0) + 1)));
  }
  if (saved.view !== "rapport") saved.view = "terrain";
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
