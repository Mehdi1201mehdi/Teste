// Déchets : recherche instantanée (jamais de liste déroulante) + pastilles amovibles.

import { $ } from "./utils.js";
import { state, save } from "./storage.js";
import { fuzzySearch } from "./search.js";
import { showSuggestions, hideSuggestions, renderChips } from "./components.js";
import { toast } from "./ui.js";
import { renderSummary } from "./bp.js";

let DECHETS_LIST = [];

// Pictogrammes pour les déchets les plus fréquents ; 🗑️ par défaut sinon.
const DICON = {
  "Sac OM": "🟢",
  Matelas: "🛏️",
  Sommier: "🛏️",
  Canapé: "🛋️",
  Cartons: "📦",
  Gravats: "🧱",
  Pneu: "🛞",
  Palette: "🪵",
  Ferraille: "🔩",
  Téléviseur: "📺",
  Réfrigérateur: "❄️",
  "Lave-linge": "🧺",
  Batterie: "🔋",
  "Déchets verts": "🌿",
  Vélo: "🚲",
};

export async function loadWaste() {
  try {
    const r = await fetch("data/waste.json");
    const categories = await r.json();
    DECHETS_LIST = [...new Set(Object.values(categories).flat())].sort((a, b) =>
      a.localeCompare(b, "fr"),
    );
  } catch (e) {
    DECHETS_LIST = [];
  }
}

export function showWaste(query) {
  const box = $("wasteSuggest");
  const input = $("wasteInput");
  const nq = query.trim();
  const list = nq ? fuzzySearch(DECHETS_LIST, nq, (d) => d, 12) : DECHETS_LIST.slice(0, 12);
  if (!list.length) {
    showSuggestions(box, [], "Aucun résultat. Appuie sur Ajouter pour reprendre le texte tapé.");
    input.setAttribute("aria-expanded", "true");
    return;
  }
  const entries = list.map((d) => ({
    html: `<span aria-hidden="true">${DICON[d] || "🗑️"}</span><span class="sugName">${d}</span>`,
    onClick: () => {
      $("wasteInput").value = d;
      hideSuggestions(box);
      addWaste();
    },
  }));
  showSuggestions(box, entries, "");
  input.setAttribute("aria-expanded", "true");
}

export function renderWastes() {
  const box = $("wasteChips");
  renderChips(
    box,
    state.current.wastes,
    (i) => {
      state.current.wastes.splice(i, 1);
      renderWastes();
      save();
    },
    "Aucun déchet ajouté.",
  );
  renderSummary();
  save();
}

export function addWaste() {
  const input = $("wasteInput");
  const w = input.value.trim();
  if (!w) {
    showWaste("");
    input.focus();
    return;
  }
  if (!state.current.wastes.includes(w)) state.current.wastes.push(w);
  input.value = "";
  hideSuggestions($("wasteSuggest"));
  renderWastes();
  toast("Déchet ajouté");
}
