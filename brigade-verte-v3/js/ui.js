// Éléments d'interface transverses : toast et bandeau hors-ligne.

import { $ } from "./utils.js";

let toastTimer;
export function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
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
