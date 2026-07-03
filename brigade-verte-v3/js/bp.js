// Bons de Passage (BP) : précisions de localisation, récapitulatif, et CRUD complet
// (ajouter / modifier / supprimer / dupliquer) avec sauvegarde automatique.

import { $, esc } from "./utils.js";
import { state, save } from "./storage.js";
import { SECTEURS, COLOR } from "./sectors.js";
import { toast } from "./ui.js";
import { go } from "./router.js";
import { renderWastes } from "./waste.js";
import { bpCardHtml, bindBpActions } from "./components.js";
import { generateMail } from "./mail.js";

// Les 7 précisions autorisées ; le libellé exact est conservé pour le mail.
export const PREC = {
  angle: "À l'angle de",
  face: "En face du n°",
  devant: "Devant le n°",
  entre: "Entre deux maisons",
  trottoir: "Sur le trottoir",
  chaussee: "Sur la chaussée",
  pav: "Au pied du PAV",
};

export function initSectors() {
  const box = $("sectors");
  box.innerHTML = "";
  SECTEURS.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sector";
    b.textContent = s;
    b.onclick = () => setSector(s);
    box.appendChild(b);
  });
}

export function setSector(s) {
  state.current.secteur = s;
  document.querySelectorAll("#sectors .sector").forEach((b) => {
    const on = b.textContent === s;
    b.classList.toggle("on", on);
    b.style.background = on ? COLOR[s] : "";
  });
  const chosen = $("chosenSector");
  chosen.textContent = s ? "Secteur " + s : "Secteur ?";
  chosen.style.background = s ? COLOR[s] : "";
  chosen.style.color = s ? "#fff" : "";
  renderSummary();
  save();
}

export function precisionLabels() {
  const num = $("numeroRue").value.trim();
  return state.current.precisions.map((k) => {
    if (k === "face") return num ? "En face du n°" + num : "En face du n°";
    if (k === "devant") return num ? "Devant le n°" + num : "Devant le n°";
    return PREC[k] || k;
  });
}

export function refreshPrecisions() {
  const labels = precisionLabels();
  document.querySelectorAll(".qbtn").forEach((b) => {
    const on = state.current.precisions.includes(b.dataset.key);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  $("precPreview").innerHTML = labels.length
    ? "<b>" + esc(labels.join(", ")) + "</b>"
    : "Aucune précision sélectionnée.";
  renderSummary();
  save();
}

export function togglePrecision(key) {
  const list = state.current.precisions;
  const i = list.indexOf(key);
  i >= 0 ? list.splice(i, 1) : list.push(key);
  refreshPrecisions();
}

export function adresseText(bp) {
  return (bp.numero ? bp.numero + " " : "") + bp.rue;
}

export function bpLine(bp) {
  let c = (bp.wastes || []).join(", ");
  if (bp.precisions && bp.precisions.length) c += (c ? ", " : "") + bp.precisions.join(", ");
  return c;
}

export function renderSummary() {
  const c = state.current;
  const p = precisionLabels();
  $("summary").innerHTML = `
    <div class="sumItem"><b>Adresse</b>${esc((c.numero ? c.numero + " " : "") + (c.rue?.rue || "Rue non choisie"))}</div>
    <div class="sumItem"><b>Secteur</b>${esc(c.secteur || "Secteur non choisi")}</div>
    <div class="sumItem"><b>Précisions</b>${esc(p.length ? p.join(", ") : "Aucune")}</div>
    <div class="sumItem"><b>Déchets</b>${esc(c.wastes.length ? c.wastes.join(", ") : "Aucun déchet")}</div>
  `;
}

export function resetCurrent(full = true) {
  state.current = { rue: null, numero: "", secteur: null, precisions: [], wastes: [] };
  state.editing = null;
  $("streetInput").value = "";
  $("numeroRue").value = "";
  $("chosenBox").classList.remove("show");
  $("streetSuggest").classList.remove("show");
  $("wasteInput").value = "";
  $("wasteSuggest").classList.remove("show");
  setSector(null);
  renderWastes();
  refreshPrecisions();
  if (full) save();
}

export function addBp() {
  const c = state.current;
  if (!c.rue) return toast("Choisis une rue");
  if (!c.secteur) return toast("Choisis le secteur");
  if (!c.wastes.length) return toast("Ajoute un déchet");
  const bp = {
    rue: c.rue.rue,
    numero: $("numeroRue").value.trim(),
    secteur: c.secteur,
    wastes: [...c.wastes],
    precisions: precisionLabels(),
  };
  if (state.editing != null) {
    state.bps[state.editing] = bp;
    state.editing = null;
    toast("BP modifiée");
  } else {
    state.bps.push(bp);
    toast("BP ajoutée");
  }
  resetCurrent(false);
  state.mailCustom = "";
  renderBps();
  generateMail();
  go(5);
}

export function editBp(i) {
  const bp = state.bps[i];
  state.editing = i;
  state.current = {
    rue: { rue: bp.rue, secteur: bp.secteur },
    numero: bp.numero || "",
    secteur: bp.secteur,
    precisions: [],
    wastes: [...(bp.wastes || [])],
  };
  $("streetInput").value = bp.rue;
  $("chosenBox").classList.add("show");
  $("chosenRue").textContent = bp.rue;
  $("numeroRue").value = bp.numero || "";
  setSector(bp.secteur);
  renderWastes();
  refreshPrecisions();
  go(1);
  toast("Modification ouverte");
}

export function duplicateBp(i) {
  const bp = JSON.parse(JSON.stringify(state.bps[i]));
  state.bps.splice(i + 1, 0, bp);
  state.mailCustom = "";
  renderBps();
  generateMail();
  save();
  toast("BP dupliquée");
}

export function delBp(i) {
  if (confirm("Supprimer cette BP ?")) {
    state.bps.splice(i, 1);
    state.mailCustom = "";
    renderBps();
    generateMail();
    save();
  }
}

export function duplicateLastAddress() {
  const last = state.bps[state.bps.length - 1];
  if (!last) return toast("Aucune BP précédente");
  state.current.rue = { rue: last.rue, secteur: last.secteur };
  state.current.numero = last.numero || "";
  state.current.secteur = last.secteur;
  state.current.precisions = [];
  $("streetInput").value = last.rue;
  $("chosenBox").classList.add("show");
  $("chosenRue").textContent = last.rue;
  $("numeroRue").value = last.numero || "";
  setSector(last.secteur);
  refreshPrecisions();
  toast("Adresse reprise — vérifie le numéro");
}

export function renderBps() {
  ["listBadge", "listBadgeMobile"].forEach((id) => {
    const e = $(id);
    if (e) e.textContent = state.bps.length + " BP";
  });
  const html = state.bps.length
    ? state.bps.map((bp, i) => bpCardHtml(bp, i, adresseText, bpLine)).join("")
    : `<div class="none">Aucune BP pour l'instant.</div>`;
  const handlers = { edit: editBp, duplicate: duplicateBp, delete: delBp };
  const listEl = $("bpList");
  const listMobileEl = $("bpListMobile");
  listEl.innerHTML = html;
  listMobileEl.innerHTML = html;
  bindBpActions(listEl, handlers);
  bindBpActions(listMobileEl, handlers);
}
