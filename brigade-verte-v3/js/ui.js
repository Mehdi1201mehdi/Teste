// Éléments transverses : toast, confirmation modale, bandeau hors connexion.

import { $ } from "./utils.js";

let toastTimer;
/**
 * Message transitoire. Option { label, onClick } : bouton d'action (ex. Annuler),
 * qui prolonge l'affichage. Option tone: "warn" pour une alerte douce.
 */
export function toast(message, action, tone) {
  const el = $("toast");
  el.textContent = "";
  el.dataset.tone = tone || "";
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
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 5500 : 2200);
}

/**
 * Confirmation accessible (remplace confirm()) — renvoie une promesse <boolean>.
 * `check` : case à cocher obligatoire avant de pouvoir confirmer (actions graves).
 */
export function confirmDialog({ title, text, ok = "Confirmer", danger = true, check = "" }) {
  const dlg = $("confirmDlg");
  if (!dlg || typeof dlg.showModal !== "function") {
    return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  }
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  const okBtn = $("confirmOk");
  okBtn.textContent = ok;
  okBtn.className = "btn " + (danger ? "btn--danger" : "btn--primary");
  const row = $("confirmCheckRow");
  const box = $("confirmCheck");
  row.hidden = !check;
  box.checked = false;
  $("confirmCheckText").textContent = check;
  okBtn.disabled = !!check;
  box.onchange = () => (okBtn.disabled = !box.checked);
  return new Promise((resolve) => {
    dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
    dlg.showModal();
    (check ? box : $("confirmCancel")).focus();
  });
}

/** Ferme une <dialog> en touchant le fond (hors du contenu). */
export function closeOnBackdrop(dlg) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close("cancel");
  });
}

export function initOfflineBanner() {
  const banner = $("offlineBanner");
  const refresh = () => (banner.hidden = navigator.onLine);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}

/** Relance une animation CSS de classe `cls` sur `el`. */
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
