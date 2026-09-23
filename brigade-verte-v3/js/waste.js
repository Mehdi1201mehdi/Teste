// Déchets : data/waste.json (familles → libellés).
// Trois façons d'ajouter, du plus rapide au plus complet :
// 1. « Les plus fréquents » — appris des tournées de l'agent ;
// 2. la recherche instantanée (quelques lettres suffisent) ;
// 3. la navigation par famille, pour ne jamais être bloqué.

import { $, esc, highlight } from "./utils.js";
import { fuzzySearch } from "./search.js";
import { showSuggestions, hideSuggestions } from "./components.js";
import { icon } from "./icons.js";

let LIST = [];
let CATS = {};
let failed = false;

// Point de départ avant que l'agent n'ait son propre historique.
const DEFAULT_FREQUENT = [
  "Sac poubelle",
  "Matelas",
  "Cartons",
  "Canapé",
  "Meuble cassé",
  "Gravats",
  "Pneu",
  "Déchets mélangés",
  "Palette",
  "Sommier",
];

// Libellés courts pour les onglets de familles.
const SHORT = {
  "Électrique / électronique (DEEE)": "DEEE",
  "Textiles et objets personnels": "Textiles & objets",
  "Métaux et ferraille": "Métaux",
  "Véhicules et épaves": "Véhicules",
};

export async function loadWaste() {
  try {
    const r = await fetch("data/waste.json");
    if (!r.ok) throw new Error(String(r.status));
    CATS = await r.json();
    LIST = [...new Set(Object.values(CATS).flat())].sort((a, b) => a.localeCompare(b, "fr"));
    failed = false;
  } catch (e) {
    CATS = {};
    LIST = [];
    failed = true;
  }
}

export const categories = () => Object.keys(CATS);
export const categoryItems = (c) => CATS[c] || [];
export const shortCat = (c) => SHORT[c] || c;

/** Les 10 déchets les plus relevés par cet agent, complétés par les défauts. */
export function frequent(freq) {
  const learned = Object.entries(freq || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))
    .map(([w]) => w);
  const out = [];
  [...learned, ...DEFAULT_FREQUENT].forEach((w) => {
    if (out.length < 10 && !out.includes(w)) out.push(w);
  });
  return out;
}

export function showWasteSuggest(query, onPick) {
  const box = $("wasteSuggest");
  const input = $("wasteInput");
  const q = query.trim();
  if (!q) {
    hideSuggestions(box, input);
    return;
  }
  const list = fuzzySearch(LIST, q, (d) => d, 10);
  const emptyMsg = failed
    ? "Liste des déchets indisponible — touchez « Ajouter » pour garder le texte tapé."
    : `Pas dans la liste — touchez « Ajouter » pour relever « ${q} ».`;
  showSuggestions(
    box,
    list.map((d) => ({ html: `<span class="sugName">${highlight(d, q)}</span>`, onClick: () => onPick(d) })),
    emptyMsg,
  );
  input.setAttribute("aria-expanded", "true");
}

/** Boutons « déchet » : aria-pressed si déjà relevé dans la saisie en cours. */
export function pickButtons(items, selected) {
  return items
    .map((w) => {
      const on = selected.includes(w);
      return `<button type="button" class="pick" data-w="${esc(w)}" aria-pressed="${on}">${icon(on ? "check" : "plus")}${esc(w)}</button>`;
    })
    .join("");
}
