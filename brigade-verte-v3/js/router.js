// Navigation : trois vues (Terrain, Rapport, Collecte) et deux temps de saisie
// (1 Lieu → 2 Déchets, enregistrement direct). Chaque changement pousse une entrée
// d'historique : le bouton « retour » d'Android/iOS revient d'un cran.

import { $ } from "./utils.js";
import { state, save } from "./storage.js";
import { addressOk, wastesOk } from "./bp.js";

const listeners = new Set();
export const onRoute = (fn) => listeners.add(fn);

/** Un temps n'est accessible que si les précédents sont remplis. */
export function canEnterStage(n) {
  if (n <= 1) return true;
  return addressOk(state.current);
}

export const STAGES = [1, 2];
/** Ancien temps « 3 · Valider » (saisies et liens d'avant) → Déchets. */
const clampStage = (n) => (STAGES.includes(n) ? n : n > 2 ? 2 : 1);

export function blockedMessage(n) {
  if (!addressOk(state.current)) return "Choisissez d'abord la rue du dépôt.";
  if (n >= 2 && !wastesOk(state.current)) return "Ajoutez au moins un déchet.";
  return "";
}

const VIEWS = ["terrain", "rapport", "collecte"];

function hashFor(view, stage) {
  return view === "terrain" ? `#terrain-${stage}` : `#${view}`;
}

function apply(view, stage, dir) {
  stage = clampStage(stage);
  const app = $("app");
  state.view = view;
  state.stage = stage;
  app.dataset.view = view;
  app.dataset.stage = String(stage);
  $("viewTerrain").hidden = view !== "terrain";
  $("viewRapport").hidden = view !== "rapport";
  $("viewCollecte").hidden = view !== "collecte";
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
  stage = clampStage(stage);
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
  const scroller = view === "terrain" ? $("composerBody") : document.querySelector(view === "rapport" ? ".reportScroll" : ".collecteScroll");
  if (window.matchMedia("(min-width: 1024px)").matches) scroller?.scrollTo({ top: 0 });
  else if (dir !== 0 || view !== "terrain") window.scrollTo({ top: 0 });
  return true;
}

export function initRouter() {
  window.addEventListener("popstate", (e) => {
    const s = e.state || {};
    const view = VIEWS.includes(s.view) ? s.view : "terrain";
    let stage = clampStage(Number(s.stage) || 1);
    while (stage > 1 && !canEnterStage(stage)) stage--;
    apply(view, stage, stage < state.stage ? -1 : 1);
  });
  // Lien direct (raccourci d'écran d'accueil, favori, lien partagé) :
  // …/#rapport, …/#collecte, …/#terrain-2 ouvrent la bonne vue.
  // Adresse modifiée à la main dans un onglet ouvert (…#rapport) : même effet
  // qu'un appui sur l'onglet (pushState ne déclenche jamais cet événement).
  window.addEventListener("hashchange", () => {
    const h = window.location.hash.match(/^#(terrain|rapport|collecte)(?:-(\d))?$/);
    if (!h) return;
    const stage = h[1] === "terrain" && h[2] ? Number(h[2]) : state.stage;
    if (h[1] !== state.view || stage !== state.stage) go(h[1], stage, { replace: true });
  });
  // Seul un lien vers une AUTRE vue compte : au rechargement, l'adresse
  // reflète déjà l'état enregistré, qui fait foi.
  const m = window.location.hash.match(/^#(terrain|rapport|collecte)(?:-(\d))?$/);
  if (m && m[1] !== state.view) {
    state.view = m[1];
    if (m[1] === "terrain" && m[2]) state.stage = Number(m[2]);
  }
  let stage = clampStage(state.stage);
  while (stage > 1 && !canEnterStage(stage)) stage--;
  window.history.replaceState({ view: state.view, stage }, "", hashFor(state.view, stage));
  apply(state.view, stage, 0);
}
