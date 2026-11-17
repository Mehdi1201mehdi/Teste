// Déchets : data/waste.json (familles → libellés).
// Trois façons d'ajouter, du plus rapide au plus complet :
// 1. « Les plus fréquents » — appris des tournées de l'agent ;
// 2. la recherche instantanée (quelques lettres suffisent) ;
// 3. la navigation par famille, pour ne jamais être bloqué.

import { $, esc, highlight, norm } from "./utils.js";
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

// Libellés courts pour les cartes de familles (2 lignes au plus).
const SHORT = {
  "Électrique / électronique (DEEE)": "Électronique (DEEE)",
  "Textiles et objets personnels": "Textiles et objets",
  "Métaux et ferraille": "Métaux, ferraille",
  "Véhicules et épaves": "Véhicules, épaves",
  "Déchets du bâtiment": "Bâtiment",
  "Déchets automobiles": "Automobile",
  "Déchets professionnels": "Professionnels",
};

/* Icônes des familles (Lucide v0.460, 24×24, trait 2) — tracés inline :
   le sprite partagé d'index.html n'est pas modifié. `trash` (suppression)
   et `triangle-alert` (alertes) ne servent à aucune famille. */
const FAMILY_ICON = {
  "Déchets ménagers": '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  Encombrants:
    '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>',
  "Électrique / électronique (DEEE)":
    '<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
  "Déchets du bâtiment":
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/>',
  "Déchets verts": '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  "Déchets automobiles":
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  "Déchets dangereux":
    '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  "Déchets agricoles":
    '<path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20"/><path d="M16 18h-5"/><path d="M18 5a1 1 0 0 0-1 1v5.573"/><path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246"/><path d="M4 11V4"/><path d="M7 15h.01"/><path d="M8 10.1V4"/><circle cx="18" cy="18" r="2"/><circle cx="7" cy="15" r="5"/>',
  "Déchets professionnels":
    '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
  "Déchets sanitaires":
    '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
  "Véhicules et épaves":
    '<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  "Déchets divers":
    '<path d="M12 22v-9"/><path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z"/><path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13"/><path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z"/>',
  "Électroménager":
    '<path d="M3 6h3"/><path d="M17 6h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"/>',
  "Textiles et objets personnels":
    '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  "Métaux et ferraille": '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>',
  "Objets divers":
    '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
};
// Carte « Autres familles » (Lucide layout-grid).
const OTHERS_ICON = '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>';

/* Les 8 familles les plus relevées sur le terrain ont leur carte en tête ;
   les autres sont regroupées derrière « Autres familles » (un toucher les
   affiche toutes : aucun libellé n'est caché, et la recherche couvre tout). */
const MAIN_FAMILIES = [
  "Encombrants",
  "Déchets ménagers",
  "Déchets du bâtiment",
  "Électrique / électronique (DEEE)",
  "Électroménager",
  "Déchets verts",
  "Déchets automobiles",
  "Déchets professionnels",
];

/** SVG inline d'une famille (repli : « Objets divers »). */
export function familyIcon(cat, cls = "icon") {
  const paths = cat === "*others" ? OTHERS_ICON : FAMILY_ICON[cat] || FAMILY_ICON["Objets divers"];
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** Familles réparties en cartes principales et « autres » (ordre de waste.json pour les autres). */
export function familyGroups() {
  const all = Object.keys(CATS);
  const main = MAIN_FAMILIES.filter((c) => all.includes(c));
  return { main, others: all.filter((c) => !main.includes(c)) };
}

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
}

/**
 * Texte tapé puis « Ajouter » / Entrée : le libellé officiel de la liste est
 * retenu dès qu'il existe (« mat » → « Matelas »), pour que le rapport ne
 * parte jamais avec une abréviation. Le texte libre n'est gardé que si
 * aucun déchet de la liste ne correspond.
 */
export function resolveTypedWaste(query) {
  const q = String(query || "").trim();
  if (!q) return "";
  const exact = LIST.find((d) => norm(d) === norm(q));
  if (exact) return exact;
  const [first] = fuzzySearch(LIST, q, (d) => d, 1);
  if (first) return first;
  return q.charAt(0).toUpperCase() + q.slice(1);
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
