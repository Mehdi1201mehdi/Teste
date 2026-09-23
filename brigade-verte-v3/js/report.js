// Vue Rapport — le message tel qu'il partira, les bons classés par secteur,
// l'envoi (copie, Outlook appli, Outlook web) et la clôture de tournée.

import { $, esc, plural, dateFr, detectPlatform } from "./utils.js";
import { state, save } from "./storage.js";
import { SECTEURS, TITRE, secStyle } from "./sectors.js";
import { adresseText } from "./bp.js";
import { mailText, mailSubject } from "./mail.js";
import { ticketHtml, bindTicketActions } from "./components.js";
import { toast, confirmDialog } from "./ui.js";
import { go } from "./router.js";
import * as map from "./map.js";

let hooks = { changed: () => {}, edit: () => {} };

/** Répartition par secteur, dans l'ordre du message. */
export function sectorCounts() {
  return SECTEURS.map((s) => ({ s, n: state.bps.filter((b) => b.secteur === s).length })).filter((x) => x.n);
}

export function sectorBarHtml(counts) {
  return counts.map(({ s, n }) => `<i class="s-${s}" style="--n:${n};${secStyle(s)}" title="${esc(TITRE[s])} : ${n}"></i>`).join("");
}

export function renderReport() {
  const n = state.bps.length;
  $("reportTitle").textContent = state.date ? `Îlotage du ${dateFr(state.date)}` : "Îlotage du jour";
  $("reportEmpty").hidden = n > 0;
  $("reportBody").hidden = n === 0;

  const counts = sectorCounts();
  const streets = new Set(state.bps.map((b) => b.rue)).size;
  $("reportStats").innerHTML = n
    ? `<div class="stat stat--signal"><b>${n}</b><span>${n > 1 ? "dépôts" : "dépôt"}</span></div>
       <div class="stat"><b>${streets}</b><span>${streets > 1 ? "rues" : "rue"}</span></div>
       <div class="sectorBreak">
         <ul>${counts.map(({ s, n: k }) => `<li style="${secStyle(s)}">${esc(s)} ${k}</li>`).join("")}</ul>
         <div class="sectorBar" aria-hidden="true">${sectorBarHtml(counts)}</div>
       </div>`
    : "";

  // Document
  const mailEl = $("mail");
  if (mailEl.getAttribute("contenteditable") !== "true") mailEl.textContent = mailText();
  $("docSubject").textContent = mailSubject();
  $("docState").hidden = !state.mailCustom;
  $("resetMail").hidden = !state.mailCustom;

  // Tickets groupés par secteur (même ordre que le message)
  const groups = SECTEURS.map((s) => {
    const items = state.bps.map((bp, i) => ({ bp, i })).filter(({ bp }) => bp.secteur === s);
    if (!items.length) return "";
    return `<div class="ticketGroup" data-sector="${s}"><div class="ticketGroupHead" style="${secStyle(s)}"><span class="sectorChip">${esc(TITRE[s])}</span><span>${items.length}</span></div>${items
      .map(({ bp, i }) => ticketHtml(bp, { num: i + 1, index: i, address: adresseText(bp), actions: true, editing: state.editing === i }))
      .join("")}</div>`;
  }).join("");
  const list = $("bpList");
  list.innerHTML = groups;
  bindTicketActions(list, { edit: (i) => hooks.edit(i), duplicate: duplicateBp, delete: delBp });
  list.querySelectorAll(".ticketGroup").forEach((g) => {
    g.addEventListener("mouseenter", () => map.focusSector(g.dataset.sector));
    g.addEventListener("mouseleave", () => map.focusSector(null));
  });
}

function duplicateBp(i) {
  const bp = JSON.parse(JSON.stringify(state.bps[i]));
  state.bps.splice(i + 1, 0, bp);
  state.mailCustom = "";
  hooks.changed({ fresh: i + 1 });
  save();
  toast(`Bon n°${i + 1} dupliqué en n°${i + 2}.`);
}

function delBp(i) {
  const removed = state.bps[i];
  if (!removed) return;
  state.bps.splice(i, 1);
  if (state.editing === i) state.editing = null;
  else if (state.editing != null && state.editing > i) state.editing--;
  state.mailCustom = "";
  hooks.changed({});
  save();
  toast(`Bon n°${i + 1} supprimé.`, {
    label: "Annuler",
    onClick: () => {
      state.bps.splice(Math.min(i, state.bps.length), 0, removed);
      state.mailCustom = "";
      hooks.changed({ fresh: i });
      save();
      toast("Suppression annulée.");
    },
  });
}

async function clearTour() {
  const n = state.bps.length;
  if (!n) return toast("Aucun bon à effacer — la tournée est déjà vide.");
  const ok = await confirmDialog({
    title: "Clôturer la tournée ?",
    text: `${plural(n, "bon de passage", "bons de passage")} ${n > 1 ? "seront supprimés" : "sera supprimé"} de cet appareil. Cette action est définitive.`,
    check: "J'ai envoyé ou sauvegardé le message.",
    ok: "Clôturer et tout effacer",
  });
  if (!ok) return;
  state.bps = [];
  state.mailCustom = "";
  state.editing = null;
  hooks.changed({ reset: true });
  go("terrain", 1);
  save();
  toast("Tournée clôturée — prêt pour la prochaine.");
}

/* ─── Envoi ─── */
function mailParams() {
  const body = $("mail").textContent;
  return { body, params: `subject=${encodeURIComponent(mailSubject())}&body=${encodeURIComponent(body)}` };
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return true;
  } catch (e) {
    // Repli : sélection manuelle du texte pour un appui long « Copier ».
    const range = document.createRange();
    range.selectNodeContents($("mail"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast("Copie automatique impossible — le texte est sélectionné, copiez-le manuellement.", null, "warn");
    return false;
  }
}

function bindSend() {
  $("copyMail").onclick = async () => {
    const ok = await copyText($("mail").textContent, "Message copié — collez-le dans votre messagerie.");
    if (ok) {
      const b = $("copyMail");
      b.classList.add("is-done");
      b.querySelector("span").textContent = "Copié";
      b.querySelector("use").setAttribute("href", "#i-check");
      setTimeout(() => {
        b.classList.remove("is-done");
        b.querySelector("span").textContent = "Copier le message";
        b.querySelector("use").setAttribute("href", "#i-copy");
      }, 1600);
    }
  };

  // Outlook : appli mobile (ms-outlook://) si installée, sinon appli mail par
  // défaut (mailto:). Sur PC, directement l'appli mail du système.
  // Texte trop long pour une URL : copié dans le presse-papiers à la place.
  $("openMail").onclick = async () => {
    const { body, params } = mailParams();
    if (params.length > 1800) return copyText(body, "Texte trop long pour un lien direct — copié à la place.");
    if (detectPlatform() === "desktop") {
      window.location.href = `mailto:?${params}`;
      return;
    }
    const fallback = setTimeout(() => {
      window.location.href = `mailto:?${params}`;
    }, 1400);
    const cancel = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(fallback);
        document.removeEventListener("visibilitychange", cancel);
      }
    };
    document.addEventListener("visibilitychange", cancel);
    window.location.href = `ms-outlook://compose?${params}`;
  };

  // Outlook sur le web : aucune appli requise (PC partagé en mairie…).
  $("openMailWeb").onclick = async () => {
    const { body, params } = mailParams();
    if (params.length > 1800) return copyText(body, "Texte trop long pour Outlook Web — copié à la place.");
    window.open(`https://outlook.office.com/mail/deeplink/compose?${params}`, "_blank", "noopener");
  };

  // Édition manuelle : un appui ouvre, un second enregistre. Survit au rechargement.
  $("editMail").onclick = () => {
    const mailEl = $("mail");
    const btn = $("editMail");
    const editing = mailEl.getAttribute("contenteditable") === "true";
    if (editing) {
      mailEl.setAttribute("contenteditable", "false");
      btn.setAttribute("aria-pressed", "false");
      btn.querySelector("span").textContent = "Modifier le texte";
      state.mailCustom = mailEl.innerText.trim();
      renderReport();
      save();
      toast("Texte enregistré.");
    } else {
      mailEl.setAttribute("contenteditable", "true");
      btn.setAttribute("aria-pressed", "true");
      btn.querySelector("span").textContent = "Terminer la modification";
      mailEl.focus();
      toast("Modifiez directement le texte.");
    }
  };

  $("resetMail").onclick = async () => {
    if (state.mailCustom) {
      const ok = await confirmDialog({
        title: "Rétablir le texte automatique ?",
        text: "Vos modifications manuelles seront perdues.",
        ok: "Rétablir",
      });
      if (!ok) return;
    }
    state.mailCustom = "";
    $("mail").setAttribute("contenteditable", "false");
    $("editMail").setAttribute("aria-pressed", "false");
    $("editMail").querySelector("span").textContent = "Modifier le texte";
    renderReport();
    save();
    toast("Texte automatique rétabli.");
  };

  $("clearAllBps").onclick = clearTour;
}

export function initReport(opts = {}) {
  hooks = { ...hooks, ...opts };
  bindSend();
}
