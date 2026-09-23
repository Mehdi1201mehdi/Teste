// Navigation : deux vues (Terrain, Rapport) et trois temps de saisie
// (1 Lieu → 2 Déchets → 3 Valider). Chaque changement pousse une entrée
// d'historique : le bouton « retour » d'Android/iOS revient d'un cran.

import { $ } from "./utils.js";
import { state, save } from "./storage.js";
import { addressOk, wastesOk } from "./bp.js";

const listeners = new Set();
export const onRoute = (fn) => listeners.add(fn);

/** Un temps n'est accessible que si les précédents sont remplis. */
export function canEnterStage(n) {
  if (n <= 1) return true;
  if (n === 2) return addressOk(state.current);
  return addressOk(state.current) && wastesOk(state.current);
}

export function blockedMessage(n) {
  if (!addressOk(state.current)) return "Choisissez d'abord la rue du dépôt.";
  if (n >= 3 && !wastesOk(state.current)) return "Ajoutez au moins un déchet.";
  return "";
}

function hashFor(view, stage) {
  return view === "rapport" ? "#rapport" : `#terrain-${stage}`;
}

function apply(view, stage, dir) {
  const app = $("app");
  state.view = view;
  state.stage = stage;
  app.dataset.view = view;
  app.dataset.stage = String(stage);
  $("viewTerrain").hidden = view !== "terrain";
  $("viewRapport").hidden = view !== "rapport";
  document.querySelectorAll("[data-view-target]").forEach((b) => {
    if (b.classList.contains("vsBtn")) {
      if (b.dataset.viewTarget === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
  });
  document.querySelectorAll(".stagePane").forEach((p) => {
    const on = +p.dataset.stage === stage;
    p.classList.toggle("is-active", on);
    p.classList.toggle("from-back", on && dir < 0);
  });
  listeners.forEach((fn) => fn(view, stage));
  save();
}

/** Change de vue et/ou de temps, avec contrôle de validité. */
export function go(view, stage = state.stage, { replace = false } = {}) {
  if (view === "terrain" && stage > state.stage && !canEnterStage(stage)) {
    return blockedMessage(stage) || false;
  }
  const dir = view === state.view ? Math.sign(stage - state.stage) : 0;
  const entry = { view, stage };
  const url = hashFor(view, stage);
  if (replace) window.history.replaceState(entry, "", url);
  else if (window.history.state?.view !== view || window.history.state?.stage !== stage) {
    window.history.pushState(entry, "", url);
  }
  apply(view, stage, dir);
  // La saisie remonte en haut ; sur desktop seul le panneau défile.
  const scroller = view === "terrain" ? $("composerBody") : document.querySelector(".reportScroll");
  if (window.matchMedia("(min-width: 1024px)").matches) scroller?.scrollTo({ top: 0 });
  else if (dir !== 0 || view === "rapport") window.scrollTo({ top: 0 });
  return true;
}

export function initRouter() {
  window.addEventListener("popstate", (e) => {
    const s = e.state || {};
    const view = s.view === "rapport" ? "rapport" : "terrain";
    let stage = [1, 2, 3].includes(s.stage) ? s.stage : 1;
    while (stage > 1 && !canEnterStage(stage)) stage--;
    apply(view, stage, stage < state.stage ? -1 : 1);
  });
  let stage = state.stage;
  while (stage > 1 && !canEnterStage(stage)) stage--;
  window.history.replaceState({ view: state.view, stage }, "", hashFor(state.view, stage));
  apply(state.view, stage, 0);
}
