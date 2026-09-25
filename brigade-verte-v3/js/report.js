// Vue Rapport — le message tel qu'il partira, les bons classés par secteur,
// l'envoi (copie, Outlook appli, Outlook web) et la clôture de tournée.

import { $, esc, plural, dateFr } from "./utils.js";
import { state, save } from "./storage.js";
import { SECTEURS, TITRE, secStyle } from "./sectors.js";
import { adresseText } from "./bp.js";
import { mailText, mailSubject } from "./mail.js";
import { buildEmailBody, parseRecipients, openEmailClient, copyEmailContent } from "./email.js";
import { ticketHtml, bindTicketActions } from "./components.js";
import { toast, confirmDialog, replay } from "./ui.js";
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

  // Répartition par quartier officiel
  const qCounts = new Map();
  state.bps.forEach((b) => {
    const q = map.quartierOfStreet(b.rue) || "Hors quartier";
    qCounts.set(q, (qCounts.get(q) || 0) + 1);
  });
  const qList = [...qCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));
  $("reportQuartiers").hidden = !n || !map.quartiersReady();
  $("reportQuartiers").innerHTML = `<span class="label">Par quartier</span><ul>${qList
    .map(([q, k]) => `<li><span>${esc(q)}</span><b class="mono">${k}</b></li>`)
    .join("")}</ul>`;

  // Document
  const mailEl = $("mail");
  // Aperçu fidèle : secteurs en gras souligné, comme dans le message collé.
  if (mailEl.getAttribute("contenteditable") !== "true") mailEl.innerHTML = buildEmailBody(mailText()).previewHtml;
  const to = $("mailTo");
  if (document.activeElement !== to) to.value = state.mailTo || "";
  $("docSubject").textContent = mailSubject();
  $("docState").hidden = !state.mailCustom;
  $("resetMail").hidden = !state.mailCustom;

  // Tickets groupés par secteur (même ordre que le message)
  const groups = SECTEURS.map((s) => {
    const items = state.bps.map((bp, i) => ({ bp, i })).filter(({ bp }) => bp.secteur === s);
    if (!items.length) return "";
    return `<div class="ticketGroup" data-sector="${s}"><div class="ticketGroupHead" style="${secStyle(s)}"><span class="sectorChip">${esc(TITRE[s])}</span><span>${items.length}</span></div>${items
      .map(({ bp, i }) => ticketHtml(bp, { num: i + 1, index: i, address: adresseText(bp), quartier: map.quartierOfStreet(bp.rue), actions: true, editing: state.editing === i }))
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

/** Ouvre le rapport sur un bon précis (mis en évidence, focus pour le lecteur d'écran). */
export function revealBp(i) {
  go("rapport");
  requestAnimationFrame(() => {
    const t = $("bp-" + i);
    if (!t) return;
    t.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    t.focus({ preventScroll: true });
    replay(t, "is-flash");
  });
}

function duplicateBp(i) {
  const bp = JSON.parse(JSON.stringify(state.bps[i]));
  state.bps.splice(i + 1, 0, bp);
  state.mailCustom = "";
  hooks.changed({ fresh: i + 1 });
  save();
  toast(`Bon n°${i + 1} dupliqué en n°${i + 2}.`, null, "ok");
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
  toast("Tournée clôturée — prêt pour la prochaine.", null, "ok");
}

/* ─── Envoi ───
   Tout passe par email.js : un seul endroit pour l'encodage, le choix du
   lien selon l'appareil, la copie (HTML + texte) et les replis. */

/** Message courant : texte en cours d'édition, sinon texte du rapport. */
function currentMessage() {
  const mailEl = $("mail");
  const text = mailEl.getAttribute("contenteditable") === "true" ? mailEl.innerText.trim() : mailText();
  const body = buildEmailBody(text);
  return { to: parseRecipients(state.mailTo).valid, subject: mailSubject(), body: body.plain, html: body.html, text };
}

function checkRecipients({ warnEmpty = false } = {}) {
  const note = $("mailToNote");
  const input = $("mailTo");
  const { valid, invalid } = parseRecipients(state.mailTo);
  input.setAttribute("aria-invalid", String(invalid.length > 0));
  if (invalid.length) {
    note.textContent = `Adresse à corriger : ${invalid.join(", ")}`;
    note.dataset.tone = "error";
    note.hidden = false;
  } else if (warnEmpty && !valid.length) {
    note.textContent = "Aucun destinataire : ajoutez l'adresse du service ci-dessus (elle sera mémorisée), ou saisissez-la dans la messagerie.";
    note.dataset.tone = "info";
    note.hidden = false;
  } else note.hidden = true;
  return { valid, invalid };
}

/** Copie avec mise en forme ; repli : texte sélectionné pour un appui long. */
async function copyEmail({ silent = false } = {}) {
  const m = currentMessage();
  const res = await copyEmailContent({ html: m.html, text: m.body });
  if (res || silent) return res;
  const range = document.createRange();
  range.selectNodeContents($("mail"));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  toast("Copie automatique impossible — le texte est sélectionné, copiez-le manuellement.", null, "warn");
  return false;
}

function showFallback(text) {
  const box = $("sendFallback");
  $("sendFallbackText").textContent = text || "Choisissez une autre façon d'envoyer ce rapport.";
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/**
 * Ouvre la messagerie. Tout se fait dans le geste de l'agent, sans attente :
 * Safari et Chrome n'autorisent l'ouverture d'une appli ou d'un onglet que
 * pendant ce geste. La copie mise en forme est lancée juste avant (bonus pour
 * obtenir les secteurs en gras souligné par un collage).
 */
async function sendVia(channel, { fromFallback = false } = {}) {
  const { invalid } = checkRecipients({ warnEmpty: true });
  if (invalid.length) {
    $("mailTo").focus();
    return toast("Corrigez l'adresse du destinataire avant d'ouvrir la messagerie.", null, "warn");
  }
  // Depuis un repli, les autres options restent affichées (si celui-ci échoue aussi).
  if (!fromFallback) $("sendFallback").hidden = true;
  const m = currentMessage();
  const copying = copyEmail({ silent: true });
  const plan = openEmailClient(channel, m, {
    onNotOpened: (p) =>
      showFallback(
        p.kind === "app"
          ? "L'appli Outlook ne semble pas installée (ou le lien a été bloqué). Essayez Outlook Web ou une autre messagerie."
          : "La messagerie ne s'est pas ouverte. Essayez Outlook Web, ou copiez le message.",
      ),
  });
  if (plan.truncated) {
    const copied = await copying;
    toast(copied ? "Rapport trop long pour un lien : il est copié — collez-le dans le corps du message." : "Rapport trop long pour un lien : copiez-le puis collez-le dans le message.", null, "warn");
  }
}

function bindSend() {
  $("copyMail").onclick = async () => {
    const res = await copyEmail();
    if (!res) return;
    toast(res === "rich" ? "Message copié avec la mise en forme — collez-le dans votre messagerie." : "Message copié (texte simple) — collez-le dans votre messagerie.", null, "ok");
    const b = $("copyMail");
    b.classList.add("is-done");
    b.querySelector("span").textContent = "Copié";
    b.querySelector("use").setAttribute("href", "#i-check");
    setTimeout(() => {
      b.classList.remove("is-done");
      b.querySelector("span").textContent = "Copier le message";
      b.querySelector("use").setAttribute("href", "#i-copy");
    }, 1600);
  };

  // Outlook : appli sur téléphone (repli Outlook Web géré par Android, ou
  // proposé à l'écran), messagerie installée sur ordinateur.
  $("openMail").onclick = () => sendVia("app");
  // Outlook sur le web : aucune appli requise (PC partagé en mairie…).
  $("openMailWeb").onclick = () => sendVia("web");
  $("fallbackWeb").onclick = () => sendVia("web", { fromFallback: true });
  $("fallbackMailto").onclick = () => sendVia("mailto", { fromFallback: true });
  $("fallbackCopy").onclick = () => $("copyMail").click();

  // Destinataire(s) : mémorisé sur l'appareil, conservé d'une tournée à l'autre.
  const to = $("mailTo");
  to.addEventListener("input", () => {
    state.mailTo = to.value.trim();
    save();
    if (!$("mailToNote").hidden) checkRecipients();
  });
  to.addEventListener("change", () => checkRecipients());

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
      toast("Texte enregistré.", null, "ok");
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
