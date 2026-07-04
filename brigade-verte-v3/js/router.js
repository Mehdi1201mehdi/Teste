// Assistant guidé en 5 étapes :
// 1 Adresse -> 2 Précisions -> 3 Déchets -> 4 Vérification -> 5 Texte final.
// On ne peut avancer que si l'étape en cours est valide ; on peut toujours revenir.
// Le bouton "retour" natif (Android/iOS) revient à l'étape précédente via l'historique.

import { $ } from "./utils.js";
import { state, save } from "./storage.js";
import { toast } from "./ui.js";

const TOTAL = 5;
const LABELS = { 1: "Adresse", 2: "Précisions", 3: "Déchets", 4: "Vérification", 5: "Texte" };

function addressOk() {
  return !!state.current.rue && !!state.current.secteur;
}

function wastesOk() {
  return state.current.wastes.length > 0;
}

/** Une étape n'est accessible que si les étapes précédentes sont remplies. */
function canEnter(n) {
  if (n <= 1) return true;
  if (n === 2 || n === 3) return addressOk();
  if (n === 4) return addressOk() && wastesOk();
  return state.bps.length > 0 || (addressOk() && wastesOk());
}

function blockedMessage(n) {
  if (!addressOk()) return "Choisis d'abord la rue";
  if (n >= 4 && !wastesOk()) return "Ajoute d'abord un déchet";
  return "Ajoute d'abord une BP";
}

/** Met à jour la barre de progression, le compteur de BP et les boutons Suivant. */
export function renderStatus() {
  const label = $("stepLabel");
  const fill = $("progressFill");
  if (label) label.textContent = `Étape ${state.step}/${TOTAL} · ${LABELS[state.step]}`;
  if (fill) fill.style.width = (state.step / TOTAL) * 100 + "%";
  const badge = $("bpBadge");
  if (badge) badge.textContent = state.bps.length + " BP";
  const next1 = $("next1");
  if (next1) next1.disabled = !addressOk();
  const next3 = $("next3");
  if (next3) next3.disabled = !wastesOk();
  const dup = $("duplicateLast");
  if (dup) dup.hidden = state.bps.length === 0;
}

function applyStep(n) {
  const previous = state.step;
  state.step = n;
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.remove("active", "slide-forward", "slide-back");
  });
  $("view" + n).classList.add("active", n >= previous ? "slide-forward" : "slide-back");
  renderStatus();
  save();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Change d'étape (avec contrôle de validité) et pousse une entrée d'historique. */
export function go(n) {
  if (n > state.step && !canEnter(n)) {
    toast(blockedMessage(n));
    return;
  }
  if (window.history.state?.step !== n) {
    window.history.pushState({ step: n }, "", `#etape-${n}`);
  }
  applyStep(n);
}

export function initRouter() {
  window.addEventListener("popstate", (e) => {
    const n = e.state?.step || 1;
    applyStep(canEnter(n) ? n : 1);
  });
  window.history.replaceState({ step: state.step || 1 }, "", `#etape-${state.step || 1}`);
}
