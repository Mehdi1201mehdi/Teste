// Persistance locale (LocalStorage) : sauvegarde à chaque interaction,
// pour ne jamais perdre une saisie si le téléphone s'éteint.

import { $, nowHM } from "./utils.js";
import { renderStatus } from "./router.js";

export const STORAGE_KEY = "brigade_verte_amiens_v3_pro";

function defaultState() {
  return {
    date: "",
    step: 1,
    current: { rue: null, numero: "", secteur: null, precisions: [], wastes: [] },
    bps: [],
    editing: null,
    lastSaved: "",
  };
}

export const state = defaultState();

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") Object.assign(state, saved);
  } catch (e) {
    /* stockage indisponible ou corrompu : on repart sur l'état par défaut */
  }
}

export function save() {
  try {
    const dateEl = $("date");
    const numEl = $("numeroRue");
    if (dateEl) state.date = dateEl.value;
    if (numEl) state.current.numero = numEl.value.trim();
    state.lastSaved = nowHM();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const statusEl = $("saveStatus");
    if (statusEl) statusEl.textContent = "💾 Enregistré";
  } catch (e) {
    /* quota dépassé ou navigation privée : la session continue en mémoire */
  }
  renderStatus();
}
