// Recherche de rue : données `data/streets.json` (rue, lat/lon, secteur par défaut),
// autocomplétion tactile, et sélection qui déclenche la résolution du secteur réel.

import { $, esc } from "./utils.js";
import { state, save } from "./storage.js";
import { fuzzySearch } from "./search.js";
import { showSuggestions, hideSuggestions } from "./components.js";
import { COLOR, resolveSector } from "./sectors.js";
import { setSector } from "./bp.js";

let RUES = [];

export async function loadStreets() {
  try {
    const r = await fetch("data/streets.json");
    RUES = await r.json();
  } catch (e) {
    RUES = [];
  }
}

export function getStreets() {
  return RUES;
}

function suggestEntry(rue) {
  const pillColor = COLOR[rue.secteur] || "#64748b";
  return {
    html: `<span class="sugName">${esc(rue.rue)}</span><span class="pill" style="background:${pillColor}">${esc(rue.secteur || "?")}</span>`,
    onClick: () => chooseRue(rue),
  };
}

export function showRueSuggest(query) {
  const box = $("streetSuggest");
  const input = $("streetInput");
  if (query.trim().length < 2) {
    hideSuggestions(box);
    input.setAttribute("aria-expanded", "false");
    return;
  }
  const list = fuzzySearch(RUES, query, (r) => r.rue, 12);
  showSuggestions(box, list.map(suggestEntry), "Aucune rue trouvée.");
  input.setAttribute("aria-expanded", "true");
}

export function chooseRue(rue) {
  state.current.rue = { rue: rue.rue, lon: rue.lon, lat: rue.lat, secteur: rue.secteur };
  $("streetInput").value = rue.rue;
  hideSuggestions($("streetSuggest"));
  $("chosenBox").classList.add("show");
  $("chosenRue").textContent = rue.rue;
  setSector(rue.secteur || null);
  $("numeroRue").focus();
  save();
}

/** Recalcule le secteur réel dès que le numéro change (géocodage + repli hors ligne). */
export async function updateSectorByAddress() {
  const rue = state.current.rue;
  const num = $("numeroRue").value.trim();
  if (!rue) return;
  const sector = await resolveSector(rue, num);
  setSector(sector);
}
