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

export function initOfflineBanner() {
  const banner = $("offlineBanner");
  const refresh = () => banner.classList.toggle("show", !navigator.onLine);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}
