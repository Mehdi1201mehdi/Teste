// Navigation : quatre vues (Accueil, Terrain, Rapports, Collecte) et deux temps de saisie
// (1 Lieu → 2 Déchets, enregistrement direct). Chaque changement pousse une entrée
// d'historique : le bouton « retour » d'Android/iOS revient d'un cran.

import { $ } from "./utils.js";
import { state, save } from "./storage.js";
import { addressOk, wastesOk } from "./bp.js";

/* ─── Points de rupture (identiques à css/layout.css) ───
   Une seule source pour le JS : ne pas réécrire ces requêtes ailleurs. */
export const MQ = {
  /** Ordinateur : barre latérale, carte plein cadre, panneau flottant. */
  desktop: "(min-width: 1024px)",
  /** Téléphone en paysage : rail, carte à gauche, saisie à droite. */
  landscapePhone: "(orientation: landscape) and (max-height: 500px) and (max-width: 1023px)",
  /** Le panneau de saisie défile seul (Terrain côte à côte avec la carte). */
  sideBySide: "(min-width: 1024px), (orientation: landscape) and (max-height: 500px)",
};
export const matches = (q) => window.matchMedia(q).matches;

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

export const VIEWS = ["accueil", "terrain", "rapport", "collecte"];
const VIEW_ID = { accueil: "viewAccueil", terrain: "viewTerrain", rapport: "viewRapport", collecte: "viewCollecte" };

function hashFor(view, stage) {
  return view === "terrain" ? `#terrain-${stage}` : `#${view}`;
}

const ROUTE_LABEL = { accueil: "Accueil", rapport: "Rapports", collecte: "Jour de collecte" };
/** Titre de la vue dans l'en-tête (rail et ordinateur). */
const VIEW_TITLE = { accueil: "Accueil", terrain: "Terrain", rapport: "Rapports", collecte: "Collecte" };

/** Saisie en cours (rue, déchets…) ou bon en modification. */
function hasDraft() {
  const c = state.current || {};
  return !!(c.rue || c.numero || (c.precisions || []).length || (c.precisionCustom || "").trim() || (c.wastes || []).length || state.editing != null);
}

function apply(view, stage, dir) {
  stage = clampStage(stage);
  const app = $("app");
  // Lecteur d'écran : le changement de vue ou d'étape est annoncé.
  const live = $("routeAnnounce");
  if (live && (view !== state.view || stage !== state.stage)) {
    live.textContent = view === "terrain" ? `Étape ${stage} sur 2 : ${stage === 1 ? "lieu du dépôt" : "déchets constatés"}` : ROUTE_LABEL[view] || "";
  }
  state.view = view;
  state.stage = stage;
  app.dataset.view = view;
  app.dataset.stage = String(stage);
  // Aussi sur <html> : le toast et les dialogues sont hors de #app.
  document.documentElement.dataset.view = view;
  const title = $("appbarView");
  if (title) title.textContent = VIEW_TITLE[view] || "";
  VIEWS.forEach((v) => {
    const el = $(VIEW_ID[v]);
    if (el) el.hidden = v !== view;
  });
  // Onglets de navigation (barre du bas, barre latérale) : page active signalée.
  document.querySelectorAll("[data-nav]").forEach((b) => {
    if (b.dataset.viewTarget === view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
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
  const prevView = state.view;
  const dir = view === state.view ? Math.sign(stage - state.stage) : 0;
  const entry = { view, stage };
  const url = hashFor(view, stage);
  if (replace) window.history.replaceState(entry, "", url);
  else if (window.history.state?.view !== view || window.history.state?.stage !== stage) {
    window.history.pushState(entry, "", url);
  }
  apply(view, stage, dir);
  // La vue remonte en haut. Terrain côte à côte avec la carte (ordinateur,
  // téléphone en paysage) : seul le panneau de saisie défile. Ailleurs, c'est
  // le document (et la zone propre au module, si elle défile elle-même).
  if (view === "terrain" && matches(MQ.sideBySide)) {
    $("composerBody")?.scrollTo({ top: 0 });
  } else if (dir !== 0 || view !== prevView || view !== "terrain") {
    window.scrollTo({ top: 0 });
    const inner = { accueil: "#dashScroll", collecte: ".collecteScroll" }[view];
    if (inner) document.querySelector(inner)?.scrollTo({ top: 0 });
  }
  return true;
}

export function initRouter() {
  window.addEventListener("popstate", (e) => {
    const s = e.state || {};
    const view = VIEWS.includes(s.view) ? s.view : "accueil";
    let stage = clampStage(Number(s.stage) || 1);
    while (stage > 1 && !canEnterStage(stage)) stage--;
    apply(view, stage, stage < state.stage ? -1 : 1);
  });
  // Lien direct (raccourci d'écran d'accueil, favori, lien partagé) :
  // …/#rapport, …/#collecte, …/#terrain-2 ouvrent la bonne vue.
  // Adresse modifiée à la main dans un onglet ouvert (…#rapport) : même effet
  // qu'un appui sur l'onglet (pushState ne déclenche jamais cet événement).
  window.addEventListener("hashchange", () => {
    const h = window.location.hash.match(/^#(accueil|terrain|rapport|collecte)(?:-(\d))?$/);
    if (!h) return;
    const stage = h[1] === "terrain" && h[2] ? Number(h[2]) : state.stage;
    if (h[1] !== state.view || stage !== state.stage) go(h[1], stage, { replace: true });
  });
  // Seul un lien vers une AUTRE vue compte : au rechargement, l'adresse
  // reflète déjà l'état enregistré, qui fait foi.
  const m = window.location.hash.match(/^#(accueil|terrain|rapport|collecte)(?:-(\d))?$/);
  if (m && m[1] !== state.view) {
    state.view = m[1];
    if (m[1] === "terrain" && m[2]) state.stage = Number(m[2]);
  }
  // Lancement sans lien (icône d'écran d'accueil, index.html) : la tournée
  // s'ouvre sur l'Accueil, sauf saisie en cours ou modification d'un bon.
  if (!window.location.hash && !hasDraft()) state.view = "accueil";
  let stage = clampStage(state.stage);
  while (stage > 1 && !canEnterStage(stage)) stage--;
  window.history.replaceState({ view: state.view, stage }, "", hashFor(state.view, stage));
  apply(state.view, stage, 0);
}
