// Rues d'Amiens : data/streets.json (rue, lat/lon, secteur par défaut).
// Recherche tolérante (accents, casse), suggestions accessibles au clavier.

import { $, esc, highlight } from "./utils.js";
import { fuzzySearch } from "./search.js";
import { showSuggestions, hideSuggestions } from "./components.js";
import { secStyle } from "./sectors.js";

let RUES = [];
let loadFailed = false;

export async function loadStreets() {
  try {
    const r = await fetch("data/streets.json");
    if (!r.ok) throw new Error(String(r.status));
    RUES = await r.json();
    loadFailed = false;
  } catch (e) {
    RUES = [];
    loadFailed = true;
  }
  return RUES;
}

export const getStreets = () => RUES;
export const streetsFailed = () => loadFailed;

/** Entrée de suggestion : nom (partie tapée mise en valeur) + secteur + distance éventuelle. */
export function streetEntry(rue, query, onChoose, meta) {
  return {
    html: `<span class="sugName">${highlight(rue.rue, query || "")}</span>${
      meta ? `<span class="sugMeta">${esc(meta)}</span>` : ""
    }<span class="sectorChip" style="${secStyle(rue.secteur)}">${esc(rue.secteur || "?")}</span>`,
    onClick: () => onChoose(rue),
  };
}

export function showStreetSuggest(query, onChoose) {
  const box = $("streetSuggest");
  const input = $("streetInput");
  if (query.trim().length < 2) {
    hideSuggestions(box, input);
    return;
  }
  const list = fuzzySearch(RUES, query, (r) => r.rue, 12);
  const emptyMsg = loadFailed
    ? "Liste des rues indisponible. Vérifiez la connexion puis rouvrez l'application."
    : "Aucune rue trouvée — vérifiez l'orthographe, ou touchez la carte.";
  showSuggestions(box, list.map((r) => streetEntry(r, query, onChoose)), emptyMsg);
  input.setAttribute("aria-expanded", "true");
}
