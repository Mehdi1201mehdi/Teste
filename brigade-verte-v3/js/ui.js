// Éléments d'interface transverses : toast et bandeau hors-ligne.

import { $ } from "./utils.js";

let toastTimer;
/**
 * Affiche un message transitoire. Une action facultative { label, onClick }
 * ajoute un bouton (ex. « Annuler ») et prolonge l'affichage.
 */
export function toast(message, action) {
  const el = $("toast");
  el.textContent = "";
  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);
  if (action && action.label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toastAction";
    btn.textContent = action.label;
    btn.onclick = () => {
      el.classList.remove("show");
      action.onClick();
    };
    el.appendChild(btn);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 5000 : 1700);
}

/** Grande coche verte animée, affichée brièvement quand une BP est ajoutée. */
let successTimer;
export function showSuccess() {
  const el = $("successCheck");
  if (!el) return;
  el.classList.remove("show");
  void el.offsetWidth; // relance l'animation si déjà jouée
  el.classList.add("show");
  clearTimeout(successTimer);
  successTimer = setTimeout(() => el.classList.remove("show"), 950);
}

export function initOfflineBanner() {
  const banner = $("offlineBanner");
  const refresh = () => banner.classList.toggle("show", !navigator.onLine);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}
