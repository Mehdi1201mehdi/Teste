// Persistance locale : chaque interaction est enregistrée, pour ne jamais
// perdre une saisie si le téléphone s'éteint ou si l'onglet est fermé.
// La clé et la forme des bons (bps) sont conservées depuis la v3 : les
// tournées en cours sur les téléphones des agents sont reprises telles quelles.

import { nowHM } from "./utils.js";

export const STORAGE_KEY = "brigade_verte_amiens_v3_pro";
const SCHEMA = 4;

/** Identifiant unique d'un bon de passage. */
export function newBpId() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch (e) {
    /* contexte non sécurisé : repli ci-dessous */
  }
  return "bp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function emptyCurrent() {
  return { rue: null, numero: "", secteur: null, secteurAuto: true, precisions: [], precisionCustom: "", wastes: [] };
}

function defaultState() {
  return {
    version: SCHEMA,
    date: "",
    dateDay: "", // jour où la date a été fixée (passage auto au jour suivant)
    view: "accueil", // "accueil" | "terrain" | "rapport" | "collecte"
    stage: 1, // 1 Lieu · 2 Déchets (enregistrement)
    current: emptyCurrent(),
    bps: [],
    editing: null,
    mailCustom: "",
    mailTo: "", // destinataire(s) du rapport, gardé d'une tournée à l'autre
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
  if (!["accueil", "rapport", "collecte"].includes(saved.view)) saved.view = "terrain";
  // Identifiant stable par bon (recherche, filtre, tri ne dépendent plus de
  // la position dans la liste). Ajouté seulement s'il manque : un identifiant
  // venu d'une ancienne version est conservé.
  saved.bps.forEach((b) => {
    if (b && typeof b === "object" && !b.id) b.id = newBpId();
  });
  if (![1, 2, 3].includes(saved.stage)) saved.stage = 1;
  saved.version = SCHEMA;
  return saved;
}

// Copie de secours d'une sauvegarde illisible : jamais écrasée par la suite,
// pour qu'une tournée abîmée reste récupérable (export manuel par un référent).
const BROKEN_KEY = STORAGE_KEY + "_illisible";

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    const saved = migrate(JSON.parse(raw || "null"));
    if (saved) Object.assign(state, saved);
  } catch (e) {
    /* stockage indisponible ou corrompu : on repart sur l'état par défaut,
       après avoir mis l'original de côté (le prochain save() l'écraserait). */
    try {
      if (raw && !localStorage.getItem(BROKEN_KEY)) localStorage.setItem(BROKEN_KEY, raw);
    } catch (e2) {
      /* stockage indisponible : rien à préserver */
    }
  }
}

/** Relit la sauvegarde (écrite par un autre onglet) dans l'état courant. */
export function reload() {
  const fresh = defaultState();
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, fresh);
  load();
}

// Caches non essentiels, libérables si l'appareil manque de place :
// la tournée passe toujours avant (jours de collecte, recherches récentes).
const DISPOSABLE = ["bv_collecte_v1", "bv_collecte_recent"];

function write() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let quotaWarned = false;
export function save() {
  try {
    state.lastSaved = nowHM();
    write();
    quotaWarned = false;
    // L'en-tête affiche l'état de sauvegarde : il se met à jour aussitôt.
    document.dispatchEvent(new CustomEvent("bv:saved"));
  } catch (e) {
    const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
    if (quota) {
      try {
        DISPOSABLE.forEach((k) => localStorage.removeItem(k));
        write();
        quotaWarned = false;
        document.dispatchEvent(new CustomEvent("bv:saved"));
        return;
      } catch (e2) {
        /* toujours plein : l'agent est prévenu ci-dessous */
      }
    }
    if (quota && !quotaWarned) {
      quotaWarned = true;
      document.dispatchEvent(new CustomEvent("bv:quota"));
    }
  }
}
