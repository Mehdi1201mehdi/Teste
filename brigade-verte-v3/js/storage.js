// Persistance locale (LocalStorage) : sauvegarde à chaque interaction,
// pour ne jamais perdre une saisie si le téléphone s'éteint.

import { $, nowHM } from "./utils.js";
import { renderStatus } from "./router.js";
import { toast } from "./ui.js";

export const STORAGE_KEY = "brigade_verte_amiens_v3_pro";
// Version du schéma de données : incrémentée quand la forme de l'état change,
// pour migrer proprement les anciennes sauvegardes au lieu de les perdre.
const SCHEMA = 3;

function defaultState() {
  return {
    version: SCHEMA,
    date: "",
    step: 1,
    current: { rue: null, numero: "", secteur: null, precisions: [], precisionCustom: "", wastes: [] },
    bps: [],
    editing: null,
    mailCustom: "",
    gps: true,
    lastSaved: "",
  };
}

export const state = defaultState();

/** Met à niveau une sauvegarde ancienne vers le schéma courant (garde-fous inclus). */
function migrate(saved) {
  if (!saved || typeof saved !== "object") return null;
  // Les futures migrations par palier viendront ici (ex. if saved.version < 4 …).
  if (!saved.current || typeof saved.current !== "object") saved.current = defaultState().current;
  if (!Array.isArray(saved.current.precisions)) saved.current.precisions = [];
  if (!Array.isArray(saved.current.wastes)) saved.current.wastes = [];
  if (!Array.isArray(saved.bps)) saved.bps = [];
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

function isQuotaError(e) {
  return e && (e.name === "QuotaExceededError" || e.code === 22 || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
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
    if (statusEl) statusEl.textContent = "Enregistré automatiquement";
  } catch (e) {
    // Quota dépassé : on prévient clairement pour éviter toute perte silencieuse.
    // (En navigation privée, la session continue simplement en mémoire.)
    if (isQuotaError(e)) {
      try {
        toast("Stockage plein : sauvegardez vos signalements dans un fichier pour ne rien perdre.");
      } catch (_) {
        /* toast indisponible : on n'aggrave pas la situation */
      }
    }
  }
  renderStatus();
}
