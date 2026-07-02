// Navigation par étapes : 1 Adresse -> 2 Déchets -> 3 Vérification -> 4 Mail.
// Le bouton "retour" natif (Android/iOS) revient à l'étape précédente grâce à l'historique.

import { $ } from "./utils.js";
import { state, save } from "./storage.js";

function stepDone(n) {
  if (n === 1) return !!state.current.rue && !!state.current.secteur;
  if (n === 2) return state.current.wastes.length > 0;
  if (n === 3) return !!state.current.rue && state.current.wastes.length > 0;
  if (n === 4) return state.bps.length > 0;
  return false;
}

export function renderStatus() {
  $("bpCount").textContent = state.bps.length;
  $("currentStep").textContent = state.step;
  document.querySelectorAll(".step").forEach((b, i) => {
    const n = i + 1;
    b.classList.toggle("active", state.step === n);
    b.classList.toggle("done", stepDone(n));
    b.setAttribute("aria-selected", String(state.step === n));
  });
  document.querySelectorAll(".nav button").forEach((b) => {
    b.classList.toggle("on", +b.dataset.next === state.step);
  });
}

function applyStep(n) {
  state.step = n;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view" + n).classList.add("active");
  document.querySelectorAll(".step,.nav button").forEach((b) => {
    b.classList.toggle("on", +b.dataset.next === n);
  });
  renderStatus();
  save();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Change d'étape et pousse une entrée d'historique (support du bouton retour natif). */
export function go(n) {
  if (window.history.state?.step !== n) {
    window.history.pushState({ step: n }, "", `#etape-${n}`);
  }
  applyStep(n);
}

export function initRouter() {
  window.addEventListener("popstate", (e) => {
    const n = e.state?.step || 1;
    applyStep(n);
  });
  window.history.replaceState({ step: state.step || 1 }, "", `#etape-${state.step || 1}`);
}
