// Éléments transverses : toast, confirmation modale, bandeau hors connexion.

import { $ } from "./utils.js";

/* ─── Toasts ───
   Quatre tons : "" (info), "ok" (succès), "warn" (alerte), "error".
   Toujours placés AU-DESSUS de la barre d'action visible : un message ne doit
   jamais masquer le bouton qui permet d'enchaîner. Fermeture manuelle possible,
   minuterie suspendue tant que le doigt/la souris/le focus est dessus. */
const TOAST_MS = { "": 2600, ok: 2600, warn: 4800, error: 6500 };
let toastTimer;
let toastRemaining = 0;
let toastStarted = 0;

function hideToast() {
  clearTimeout(toastTimer);
  $("toast")?.classList.remove("show");
}

function armToast(ms) {
  clearTimeout(toastTimer);
  toastRemaining = ms;
  toastStarted = Date.now();
  toastTimer = setTimeout(hideToast, ms);
}

/** Bord haut de la barre d'action visible (px depuis le bas de l'écran). */
function toastOffset() {
  const bars = [...document.querySelectorAll(".actionBar, .sendBar")];
  const vh = window.innerHeight;
  let off = 0;
  bars.forEach((b) => {
    const r = b.getBoundingClientRect();
    if (r.height && r.top < vh && r.bottom > vh - 4) off = Math.max(off, vh - r.top);
  });
  return off;
}

/**
 * Message transitoire. `action` { label, onClick } : bouton d'action (ex. Annuler),
 * qui prolonge l'affichage. `tone` : "" | "ok" | "warn" | "error".
 */
export function toast(message, action, tone = "") {
  const el = $("toast");
  if (!el) return;
  const t = TOAST_MS[tone] != null ? tone : "";
  el.textContent = "";
  el.dataset.tone = t;
  // Les alertes interrompent le lecteur d'écran, les infos attendent leur tour.
  el.setAttribute("role", t === "error" || t === "warn" ? "alert" : "status");
  el.setAttribute("aria-live", t === "error" || t === "warn" ? "assertive" : "polite");

  const span = document.createElement("span");
  span.className = "toastText";
  span.textContent = message;
  el.appendChild(span);
  if (action && action.label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toastAction";
    btn.textContent = action.label;
    btn.onclick = () => {
      hideToast();
      action.onClick();
    };
    el.appendChild(btn);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toastClose";
  close.setAttribute("aria-label", "Fermer le message");
  close.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg>';
  close.onclick = hideToast;
  el.appendChild(close);

  el.style.setProperty("--toast-lift", toastOffset() + "px");
  el.classList.remove("show", "is-nudge");
  void el.offsetWidth; // relance l'entrée si un toast était déjà affiché
  el.classList.add("show");
  if (t === "warn" || t === "error") el.classList.add("is-nudge");
  armToast(action ? Math.max(5500, TOAST_MS[t]) : TOAST_MS[t]);
  if (t === "ok") haptic(12);
  else if (t === "warn" || t === "error") haptic([14, 60, 14]);
}

/** Pause de la minuterie pendant l'interaction (lecture, visée du bouton). */
export function initToast() {
  const el = $("toast");
  if (!el) return;
  const pause = () => {
    if (!el.classList.contains("show")) return;
    clearTimeout(toastTimer);
    toastRemaining -= Date.now() - toastStarted;
  };
  const resume = () => {
    if (el.classList.contains("show")) armToast(Math.max(1200, toastRemaining));
  };
  el.addEventListener("pointerenter", pause);
  el.addEventListener("pointerleave", resume);
  el.addEventListener("focusin", pause);
  el.addEventListener("focusout", resume);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideToast();
  });
}

/**
 * Retour haptique discret (Android ; iOS l'ignore). Coupé si l'utilisateur
 * demande moins d'animations : même intention, « moins de stimulation ».
 */
export function haptic(pattern) {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* navigateur sans vibration */
  }
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
