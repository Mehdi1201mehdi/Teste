// Éléments d'interface transverses : toast, horloge, vacation, bandeau hors-ligne.

import { $, nowHM } from "./utils.js";
import { state, save, VACATIONS, autoVacation } from "./storage.js";

let toastTimer;
export function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
}

export function updateClock() {
  $("clock").textContent = nowHM();
}

export function renderVacations() {
  const box = $("vacations");
  if (!state.vacation) state.vacation = autoVacation();
  box.innerHTML = VACATIONS.map(
    (v) => `<button type="button" class="${state.vacation === v ? "on" : ""}" data-v="${v}">${v}</button>`,
  ).join("");
  box.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.vacation = b.dataset.v;
      renderVacations();
      save();
    };
  });
}

export function initOfflineBanner() {
  const banner = $("offlineBanner");
  const refresh = () => banner.classList.toggle("show", !navigator.onLine);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}
