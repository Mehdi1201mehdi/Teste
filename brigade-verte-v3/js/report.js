// Vue Rapport — le message tel qu'il partira, les bons classés par secteur,
// l'envoi (copie, Outlook appli, Outlook web) et la clôture de tournée.
// La liste des bons a sa barre d'outils (recherche, filtre secteur, tri) : son
// état vit ici, hors du DOM, et survit donc aux re-rendus de renderReport().

import { $, esc, norm, plural, dateFr, scrollBehavior } from "./utils.js";
import { state, save, newBpId } from "./storage.js";
import { SECTEURS, TITRE, secStyle } from "./sectors.js";
import { adresseText } from "./bp.js";
import { mailText, mailSubject } from "./mail.js";
import { buildEmailBody, parseRecipients, openEmailClient, copyEmailContent, rememberAndroidMailto } from "./email.js";
import { ticketHtml, bindTicketActions, sectorName } from "./components.js";
import { toast, confirmDialog, replay } from "./ui.js";
import { go } from "./router.js";
import * as map from "./map.js";

let hooks = { changed: () => {}, edit: () => {} };

/* ─── État de la liste (recherche, filtre, tri, détails dépliés) ─── */
const ledger = { q: "", sector: "all", sort: "sector" };
const SORTS = ["sector", "recent", "old"];
/** Bons dont la consultation détaillée est dépliée (par identifiant stable). */
const openKeys = new Set();
const keyOf = (bp, i) => (bp && bp.id) || `idx-${i}`;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Répartition par secteur, dans l'ordre du message. */
export function sectorCounts() {
  return SECTEURS.map((s) => ({ s, n: state.bps.filter((b) => b.secteur === s).length })).filter((x) => x.n);
}

export function sectorBarHtml(counts) {
  return counts.map(({ s, n }) => `<i class="s-${s}" style="--n:${n};${secStyle(s)}" title="${esc(TITRE[s])} : ${n}"></i>`).join("");
}

function statHtml(label, value, meta = "") {
  // Ligne de sous-titre toujours présente : les valeurs restent alignées d'une tuile à l'autre.
  return `<div class="stat"><span class="stat__label">${label}</span><b class="stat__value">${value}</b>${meta ? `<span class="stat__meta">${meta}</span>` : `<span class="stat__meta" aria-hidden="true">&nbsp;</span>`}</div>`;
}

export function renderReport() {
  const n = state.bps.length;
  $("reportTitle").textContent = state.date ? `Îlotage du ${dateFr(state.date)}` : "Îlotage du jour";
  $("reportEmpty").hidden = n > 0;
  $("reportBody").hidden = n === 0;
  $("reportLead").hidden = n === 0;

  // Indicateurs honnêtes : 1 bon = 1 dépôt = 1 ligne du rapport.
  const counts = sectorCounts();
  const streets = new Set(state.bps.map((b) => b.rue)).size;
  const wastes = state.bps.reduce((sum, b) => sum + (b.wastes || []).length, 0);
  $("reportStats").innerHTML = n
    ? `<div class="statGrid">
         ${statHtml("Dépôts relevés", n, n > 1 ? "bons de passage" : "bon de passage")}
         ${statHtml("Rues distinctes", streets)}
         ${statHtml("Secteurs concernés", `${counts.length}<small> / 5</small>`)}
         ${statHtml("Déchets relevés", wastes)}
       </div>
       <div class="sectorBreak">
         <span class="sectorBreak__label">Répartition par secteur</span>
         <div class="sectorBar" aria-hidden="true">${sectorBarHtml(counts)}</div>
         <ul>${counts.map(({ s, n: k }) => `<li style="${secStyle(s)}">${esc(sectorName(s))} <b>${k}</b></li>`).join("")}</ul>
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

  renderLedger();
}

/* ─── Liste des bons ─── */

/** Le bon correspond-il à la recherche et au filtre en cours ? */
function matches(bp) {
  if (ledger.sector !== "all" && bp.secteur !== ledger.sector) return false;
  const q = norm(ledger.q);
  if (!q) return true;
  // Insensible aux accents et à la casse ; tous les mots doivent figurer.
  const hay = norm(`${adresseText(bp)} ${map.quartierOfStreet(bp.rue) || ""}`);
  return q.split(" ").every((w) => hay.includes(w));
}

const stamp = (bp) => Date.parse((bp && bp.createdAt) || "") || null;

/**
 * Ordre chronologique croissant. Les bons sans horodatage (versions
 * antérieures) sont les plus anciens et suivent l'ordre de saisie ; aucune
 * heure n'est inventée.
 */
function chrono(a, b) {
  const ta = stamp(a.bp);
  const tb = stamp(b.bp);
  if (ta == null && tb == null) return a.i - b.i;
  if (ta == null) return -1;
  if (tb == null) return 1;
  return ta - tb || a.i - b.i;
}

function tickets(items, level) {
  return items
    .map(({ bp, i }) =>
      ticketHtml(bp, {
        num: i + 1, // ordre de saisie : le numéro du rapport
        index: i,
        address: adresseText(bp),
        quartier: map.quartierOfStreet(bp.rue),
        actions: true,
        editing: state.editing === i,
        open: openKeys.has(keyOf(bp, i)),
        level,
      }),
    )
    .join("");
}

function buildSegment() {
  const box = $("ledgerSector");
  if (box.childElementCount) return;
  box.innerHTML = ["all", ...SECTEURS]
    .map(
      (s) =>
        `<button type="button" class="segBtn" data-sector="${s}" aria-pressed="false"${s === "all" ? "" : ` style="${secStyle(s)}"`}><span class="segBtn__name">${s === "all" ? "Tous" : esc(sectorName(s))}</span><span class="segBtn__n" aria-hidden="true"></span></button>`,
    )
    .join("");
  box.querySelectorAll(".segBtn").forEach((b) => {
    b.onclick = () => {
      ledger.sector = b.dataset.sector;
      renderLedger();
    };
  });
}

/** Met à jour le segment sans le reconstruire (le focus clavier est conservé). */
function syncSegment() {
  buildSegment();
  const counts = new Map(SECTEURS.map((s) => [s, state.bps.filter((b) => b.secteur === s).length]));
  // Le secteur choisi n'a plus de bon (suppression, clôture) : retour à « Tous ».
  if (ledger.sector !== "all" && !counts.get(ledger.sector)) ledger.sector = "all";
  $("ledgerSector")
    .querySelectorAll(".segBtn")
    .forEach((b) => {
      const s = b.dataset.sector;
      const k = s === "all" ? state.bps.length : counts.get(s) || 0;
      b.querySelector(".segBtn__n").textContent = k;
      b.disabled = s !== "all" && !k;
      b.setAttribute("aria-pressed", String(ledger.sector === s));
      b.setAttribute("aria-label", `${s === "all" ? "Tous les secteurs" : TITRE[s]} : ${plural(k, "bon")}`);
    });
}

function renderLedger() {
  syncSegment();
  const search = $("ledgerSearch");
  if (document.activeElement !== search && search.value !== ledger.q) search.value = ledger.q;
  $("ledgerSort").value = ledger.sort;

  const total = state.bps.length;
  const items = state.bps.map((bp, i) => ({ bp, i })).filter(({ bp }) => matches(bp));
  let html = "";
  if (ledger.sort === "sector") {
    // Groupés par secteur, dans l'ordre du message ; ordre de saisie dans chaque groupe.
    const known = SECTEURS.map((s) => ({ s, list: items.filter(({ bp }) => bp.secteur === s) }));
    const other = items.filter(({ bp }) => !SECTEURS.includes(bp.secteur));
    if (other.length) known.push({ s: "", list: other });
    html = known
      .filter((g) => g.list.length)
      .map(
        ({ s, list }) =>
          `<div class="ticketGroup" data-sector="${s}"><h3 class="ticketGroupHead" style="${secStyle(s)}"><span class="sectorChip">${esc(TITRE[s] || "Secteur non renseigné")}</span><span class="ticketGroupCount">${plural(list.length, "bon")}</span></h3>${tickets(list, 4)}</div>`,
      )
      .join("");
  } else {
    const sorted = [...items].sort(chrono);
    if (ledger.sort === "recent") sorted.reverse();
    html = `<div class="ticketGroup ticketGroup--flat">${tickets(sorted, 3)}</div>`;
  }

  const list = $("bpList");
  list.innerHTML = items.length ? html : "";
  bindTicketActions(list, { edit: (i) => hooks.edit(i), duplicate: duplicateBp, delete: deleteWithFold, details: toggleDetails });
  list.querySelectorAll(".ticketGroup[data-sector]").forEach((g) => {
    g.addEventListener("mouseenter", () => map.focusSector(g.dataset.sector || null));
    g.addEventListener("mouseleave", () => map.focusSector(null));
  });

  const shown = items.length;
  $("ledgerCount").textContent = `${shown} ${shown > 1 ? "bons affichés" : "bon affiché"} sur ${total}`;
  const filtered = !!norm(ledger.q) || ledger.sector !== "all";
  $("ledgerCount").classList.toggle("is-filtered", filtered);
  const empty = $("ledgerEmpty");
  empty.hidden = !(total && !shown);
  if (!empty.hidden) {
    const where = ledger.sector !== "all" ? ` dans le secteur ${sectorName(ledger.sector)}` : "";
    $("ledgerEmptyText").textContent = norm(ledger.q) ? `Aucun bon ne correspond à « ${ledger.q.trim()} »${where}.` : `Aucun bon${where}.`;
  }
  $("ledgerTools").hidden = total === 0;
}

function toggleDetails(i) {
  const bp = state.bps[i];
  const t = $("bp-" + i);
  if (!bp || !t) return;
  const key = keyOf(bp, i);
  const open = !openKeys.has(key);
  if (open) openKeys.add(key);
  else openKeys.delete(key);
  t.classList.toggle("is-open", open);
  const panel = $(`bp-${i}-details`);
  if (panel) panel.hidden = !open;
  t.querySelector('[data-action="details"]')?.setAttribute("aria-expanded", String(open));
}

/** Remet la recherche et le filtre à zéro (le tri choisi est conservé). */
function resetLedgerFilters() {
  ledger.q = "";
  ledger.sector = "all";
  $("ledgerSearch").value = "";
}

/** Ouvre le rapport sur un bon précis (mis en évidence, focus pour le lecteur d'écran). */
export function revealBp(i) {
  // Un filtre ou une recherche le masquerait : la liste est remise à zéro.
  const bp = state.bps[i];
  if (bp && !matches(bp)) resetLedgerFilters();
  if (bp && !$("bp-" + i)) renderLedger();
  go("rapport");
  requestAnimationFrame(() => {
    const t = $("bp-" + i);
    if (!t) return;
    t.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    t.focus({ preventScroll: true });
    replay(t, "is-flash");
  });
}

/**
 * Les bons ont changé : un texte retouché à la main n'est plus à jour (il lui
 * manquerait le nouveau bon). Il est remplacé par le texte automatique, et la
 * fonction renvoie la phrase à ajouter au message de confirmation pour que
 * l'agent sache qu'il doit refaire ses retouches.
 */
export function invalidateMail() {
  const mailEl = $("mail");
  const wasEditing = mailEl?.getAttribute("contenteditable") === "true";
  const had = !!state.mailCustom || wasEditing;
  state.mailCustom = "";
  if (wasEditing) {
    mailEl.setAttribute("contenteditable", "false");
    $("editMail").setAttribute("aria-pressed", "false");
    $("editMail").querySelector("span").textContent = "Modifier le texte";
  }
  return had ? " Texte du rapport recalculé : refaites vos retouches." : "";
}

function duplicateBp(i) {
  const bp = JSON.parse(JSON.stringify(state.bps[i]));
  // Le double est un nouveau relevé : il prend l'heure de sa création.
  bp.createdAt = new Date().toISOString();
  bp.id = newBpId();
  delete bp.updatedAt;
  state.bps.splice(i + 1, 0, bp);
  const note = invalidateMail();
  hooks.changed({ fresh: i + 1 });
  save();
  replay($("bp-" + (i + 1)), "is-flash");
  toast(`Bon n°${i + 1} dupliqué en n°${i + 2}.${note}`, null, note ? "warn" : "ok");
}

/** Suppression : la carte se replie (220 ms), puis le bon est retiré. */
function deleteWithFold(i) {
  const t = $("bp-" + i);
  const id = state.bps[i]?.id;
  if (!t || !id || reducedMotion()) return delBp(i);
  if (t.classList.contains("is-removing")) return;
  t.style.height = t.offsetHeight + "px";
  void t.offsetHeight;
  t.classList.add("is-removing");
  setTimeout(() => {
    const k = state.bps.findIndex((b) => b.id === id);
    if (k >= 0) delBp(k);
  }, 220);
}

function delBp(i) {
  const removed = state.bps[i];
  if (!removed) return;
  state.bps.splice(i, 1);
  if (state.editing === i) state.editing = null;
  else if (state.editing != null && state.editing > i) state.editing--;
  const note = invalidateMail();
  hooks.changed({});
  save();
  // Focus sur le bon suivant (ou la liste) : le clavier ne repart pas du haut.
  ($("bp-" + i) || $("bp-" + (i - 1)) || ($("reportBody").hidden ? $("reportEmpty").querySelector("button") : $("ledgerTitle")))?.focus({ preventScroll: true });
  toast(`Bon n°${i + 1} supprimé.${note}`, {
    label: "Annuler",
    onClick: () => {
      state.bps.splice(Math.min(i, state.bps.length), 0, removed);
      invalidateMail();
      hooks.changed({ fresh: i });
      save();
      replay($("bp-" + Math.min(i, state.bps.length - 1)), "is-flash");
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
  invalidateMail();
  state.editing = null;
  openKeys.clear();
  resetLedgerFilters();
  $("sendStatus").hidden = true;
  hooks.changed({ reset: true });
  go("terrain", 1);
  save();
  // Prêt pour la tournée suivante (sans ouvrir le clavier de force sur mobile).
  (window.matchMedia("(pointer: coarse)").matches ? $("panel") : $("streetInput")).focus({ preventScroll: true });
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
  return { to: parseRecipients(state.mailTo).valid, subject: mailSubject(), body: body.plain, bodyCompact: body.plainCompact, html: body.html, text };
}

function checkRecipients({ warnEmpty = false } = {}) {
  const note = $("mailToNote");
  const input = $("mailTo");
  const { valid, invalid } = parseRecipients(state.mailTo);
  input.setAttribute("aria-invalid", String(invalid.length > 0));
  clearTimeout(note._t);
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

/**
 * Retour visuel sur un bouton (icône → check, nouveau libellé) pendant 2 s,
 * puis retour à l'état initial.
 */
function flashButton(btn, label, ms = 2000) {
  if (!btn) return;
  const span = btn.querySelector("span");
  const use = btn.querySelector("use");
  if (!btn.dataset.idleLabel) {
    btn.dataset.idleLabel = span?.textContent || "";
    btn.dataset.idleIcon = use?.getAttribute("href") || "";
  }
  clearTimeout(btn._flash);
  btn.classList.add("is-done");
  if (span) span.textContent = label;
  use?.setAttribute("href", "#i-check");
  btn._flash = setTimeout(() => restoreButton(btn), ms);
}

function restoreButton(btn) {
  if (!btn?.dataset.idleLabel) return;
  clearTimeout(btn._flash);
  btn.classList.remove("is-done");
  const span = btn.querySelector("span");
  if (span) span.textContent = btn.dataset.idleLabel;
  btn.querySelector("use")?.setAttribute("href", btn.dataset.idleIcon);
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
  box.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
}

/**
 * Android : le navigateur est revenu sur l'application parce que l'appli
 * Outlook n'a pas pu s'ouvrir directement. On le retient (les envois suivants
 * passeront par la messagerie du téléphone) et on propose les autres voies.
 */
export function showOutlookAndroidFailed() {
  rememberAndroidMailto();
  showFallback(
    "L'appli Outlook n'a pas pu s'ouvrir directement sur ce téléphone. Touchez « Autre messagerie », choisissez Outlook puis « Toujours » : les prochains envois l'ouvriront directement.",
  );
}

/** Message d'état sous la barre d'envoi : jamais « envoyé », seulement « ouvert ». */
function showSendStatus(text) {
  const st = $("sendStatus");
  clearTimeout(st._t);
  st.textContent = text;
  st.hidden = !text;
  if (text) st._t = setTimeout(() => (st.hidden = true), 15000);
}

const OPENED = {
  app: { btn: "Messagerie ouverte", text: "Messagerie ouverte avec le message prérempli : vérifiez-le puis envoyez-le depuis Outlook. Pensez ensuite à clôturer la tournée." },
  web: { btn: "Outlook Web ouvert", text: "Outlook Web ouvert avec le message prérempli : vérifiez-le puis envoyez-le depuis Outlook. Pensez ensuite à clôturer la tournée." },
  mailto: { btn: "Messagerie ouverte", text: "Messagerie ouverte avec le message prérempli : vérifiez-le puis envoyez-le. Pensez ensuite à clôturer la tournée." },
};

/**
 * Ouvre la messagerie. Tout se fait dans le geste de l'agent, sans attente :
 * Safari et Chrome n'autorisent l'ouverture d'une appli ou d'un onglet que
 * pendant ce geste. La copie mise en forme est lancée juste avant (bonus pour
 * obtenir les secteurs en gras souligné par un collage).
 */
async function sendVia(channel, { fromFallback = false, btn = null } = {}) {
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
    onNotOpened: (p) => {
      restoreButton(btn);
      showSendStatus("");
      showFallback(
        p.kind === "app"
          ? "L'appli Outlook ne semble pas installée (ou le lien a été bloqué). Essayez Outlook Web ou une autre messagerie."
          : "La messagerie ne s'est pas ouverte. Essayez Outlook Web, ou copiez le message.",
      );
    },
  });
  const o = OPENED[channel] || OPENED.app;
  flashButton(btn, o.btn);
  showSendStatus(o.text);
  if (plan.truncated) {
    const copied = await copying;
    toast(copied ? "Rapport trop long pour un lien : il est copié — collez-le dans le corps du message." : "Rapport trop long pour un lien : copiez-le puis collez-le dans le message.", null, "warn");
  }
}

function bindSend() {
  const doCopy = async (extra) => {
    const res = await copyEmail();
    if (!res) return;
    toast(res === "rich" ? "Message copié avec la mise en forme — collez-le dans votre messagerie." : "Message copié (texte simple) — collez-le dans votre messagerie.", null, "ok");
    flashButton($("copyMail"), "Copié ✓");
    if (extra) flashButton(extra, "Copié ✓");
  };
  $("copyMail").onclick = () => doCopy();

  // Outlook : appli sur téléphone (repli Outlook Web géré par Android, ou
  // proposé à l'écran), messagerie installée sur ordinateur.
  $("openMail").onclick = () => sendVia("app", { btn: $("openMail") });
  // Outlook sur le web : aucune appli requise (PC partagé en mairie…).
  $("openMailWeb").onclick = () => sendVia("web", { btn: $("openMailWeb") });
  $("fallbackWeb").onclick = () => sendVia("web", { fromFallback: true, btn: $("fallbackWeb") });
  $("fallbackMailto").onclick = () => sendVia("mailto", { fromFallback: true, btn: $("fallbackMailto") });
  $("fallbackCopy").onclick = () => doCopy($("fallbackCopy"));

  // Destinataire(s) : mémorisé sur l'appareil, conservé d'une tournée à l'autre.
  const to = $("mailTo");
  to.addEventListener("input", () => {
    state.mailTo = to.value.trim();
    save();
    if (!$("mailToNote").hidden) checkRecipients();
  });
  to.addEventListener("change", () => {
    const { valid, invalid } = checkRecipients();
    if (!invalid.length && valid.length) {
      const note = $("mailToNote");
      note.textContent = `Destinataire mémorisé sur cet appareil ✓`;
      note.dataset.tone = "ok";
      note.hidden = false;
      note._t = setTimeout(() => (note.hidden = true), 2500);
    }
  });

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

/** Barre d'outils de la liste : recherche, filtre secteur (segment), tri. */
function bindLedgerTools() {
  const search = $("ledgerSearch");
  const onSearch = () => {
    if (ledger.q === search.value) return;
    ledger.q = search.value;
    renderLedger();
  };
  search.addEventListener("input", onSearch);
  search.addEventListener("search", onSearch);
  $("ledgerSort").addEventListener("change", (e) => {
    ledger.sort = SORTS.includes(e.target.value) ? e.target.value : "sector";
    renderLedger();
  });
  $("ledgerReset").onclick = () => {
    resetLedgerFilters();
    renderLedger();
    search.focus();
  };
  buildSegment();
}

export function initReport(opts = {}) {
  hooks = { ...hooks, ...opts };
  bindSend();
  bindLedgerTools();
}
