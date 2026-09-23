// Vue Terrain — le composeur de bon de passage en trois temps.
//   1 · Lieu     rue (recherche, GPS, carte ou « même adresse »), numéro,
//                secteur (déduit, modifiable), emplacement précis
//   2 · Déchets  fréquents, recherche, familles
//   3 · Valider  ticket final + la ligne exacte qui partira dans le message
// Après enregistrement, on reste sur le terrain : le composeur se remet à zéro
// pour le dépôt suivant, la balise tombe sur la carte, le compteur avance.

import { $, esc, plural } from "./utils.js";
import { state, save, emptyCurrent } from "./storage.js";
import { SECTEURS, secStyle, resolveSector } from "./sectors.js";
import { buildBp, adresseText, mailLine, splitPrecisions, addressOk, wastesOk } from "./bp.js";
import { showStreetSuggest, streetEntry, getStreets } from "./streets.js";
import { showWasteSuggest, frequent, categories, categoryItems, shortCat, pickButtons } from "./waste.js";
import { showSuggestions, hideSuggestions, bindComboKeys, renderChips, ticketHtml } from "./components.js";
import { toast, replay } from "./ui.js";
import { go, canEnterStage, blockedMessage, onRoute } from "./router.js";
import * as map from "./map.js";
import { locate, fmtDist } from "./geo.js";

let activeCat = null;
let freshWaste = null;
let hooks = { changed: () => {} };

/* ═════════════ Lieu ═════════════ */

export function chooseRue(rue, { fly = true } = {}) {
  const c = state.current;
  c.rue = { rue: rue.rue, lon: rue.lon, lat: rue.lat, secteur: rue.secteur };
  c.secteur = rue.secteur || null;
  c.secteurAuto = true;
  $("streetInput").value = rue.rue;
  hideSuggestions($("streetSuggest"), $("streetInput"));
  map.setTarget(rue.rue, { fly });
  map.clearProbe();
  $("mapPick").hidden = true;
  renderPlace();
  renderComposer();
  save();
  // Le numéro est la prochaine info utile : on y place le curseur (sans ouvrir
  // le clavier de force sur mobile si l'agent venait de la carte).
  if (!window.matchMedia("(pointer: coarse)").matches) $("numeroRue").focus();
  if (!c.secteur) toast("Secteur inconnu pour cette rue — choisissez-le.", null, "warn");
}

function clearRue() {
  const c = state.current;
  c.rue = null;
  c.secteur = null;
  c.secteurAuto = true;
  $("streetInput").value = "";
  map.setTarget(null);
  renderPlace();
  renderComposer();
  save();
  $("streetInput").focus();
}

function setSector(s, auto) {
  state.current.secteur = s;
  state.current.secteurAuto = auto;
  map.focusSector(auto ? null : s);
  renderPlace();
  renderComposer();
  save();
}

function renderPlace() {
  const c = state.current;
  const card = $("placeCard");
  card.hidden = !c.rue;
  $("streetClear").hidden = !$("streetInput").value;
  if (!c.rue) return;
  $("placeStreet").textContent = c.rue.rue;
  const tag = $("sectorTag");
  tag.setAttribute("style", secStyle(c.secteur));
  $("sectorTagText").innerHTML = c.secteur
    ? `${esc(c.secteur)} <span class="auto">· ${c.secteurAuto ? "auto" : "choisi"}</span>`
    : "Secteur à choisir";
  if (!c.secteur) {
    $("sectorPicker").hidden = false;
    tag.setAttribute("aria-expanded", "true");
  }
  $("sectorPicker").querySelectorAll(".sectorOpt").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.s === c.secteur));
    b.tabIndex = b.dataset.s === (c.secteur || SECTEURS[0]) ? 0 : -1;
  });
}

let sectorReq = 0;
async function refineSector() {
  const c = state.current;
  if (!c.rue || !c.secteurAuto) return;
  const req = ++sectorReq;
  const s = await resolveSector(c.rue, (c.numero || "").trim());
  if (req !== sectorReq || !state.current.rue || !state.current.secteurAuto) return;
  if (s && s !== c.secteur) {
    c.secteur = s;
    renderPlace();
    renderComposer();
    save();
    toast(`Secteur ajusté d'après le numéro : ${s}`);
  }
}

function renderPrecisions() {
  const on = state.current.precisions;
  document.querySelectorAll("#precField .toggle").forEach((b) => {
    b.setAttribute("aria-pressed", String(on.includes(b.dataset.key)));
  });
}

async function useMyPosition(btn) {
  const buttons = [$("locateBtn"), $("mapLocate")];
  buttons.forEach((b) => b.setAttribute("aria-busy", "true"));
  try {
    const { lat, lon } = await locate();
    map.setMe(lat, lon);
    const near = map.nearestStreets(lat, lon, 5);
    if (!near.length) return toast("Liste des rues indisponible.", null, "warn");
    if (state.view !== "terrain" || state.stage !== 1) go("terrain", 1);
    const input = $("streetInput");
    showSuggestions(
      $("streetSuggest"),
      near.map(({ r, d }) => streetEntry(r, "", (rue) => chooseRue(rue), fmtDist(d))),
      "",
    );
    input.setAttribute("aria-expanded", "true");
    toast("Touchez votre rue dans la liste.");
    if (btn === $("mapLocate")) input.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch (e) {
    toast(e.message, null, "warn");
  } finally {
    buttons.forEach((b) => b.removeAttribute("aria-busy"));
  }
}

function duplicateLastAddress() {
  const last = state.bps[state.bps.length - 1];
  if (!last) return;
  const rue = getStreets().find((r) => r.rue === last.rue) || { rue: last.rue, secteur: last.secteur };
  chooseRue(rue);
  const c = state.current;
  c.secteur = last.secteur;
  c.secteurAuto = last.secteur === rue.secteur;
  c.numero = last.numero || "";
  $("numeroRue").value = c.numero;
  renderPlace();
  renderComposer();
  save();
  toast("Adresse reprise — vérifiez le numéro.");
}

/* ═════════════ Déchets ═════════════ */

function addWaste(label) {
  const w = String(label || "").trim();
  if (!w) return;
  const list = state.current.wastes;
  if (list.includes(w)) {
    toast(`« ${w} » est déjà relevé.`);
  } else {
    list.push(w);
    freshWaste = w;
  }
  $("wasteInput").value = "";
  hideSuggestions($("wasteSuggest"), $("wasteInput"));
  renderWastes();
  renderComposer();
  save();
}

function toggleWaste(w) {
  const list = state.current.wastes;
  const i = list.indexOf(w);
  if (i >= 0) {
    list.splice(i, 1);
    renderWastes();
    renderComposer();
    save();
  } else addWaste(w);
}

function renderWastes() {
  const list = state.current.wastes;
  $("foundBox").classList.toggle("has-items", list.length > 0);
  renderChips(
    $("wasteChips"),
    list,
    (i) => {
      list.splice(i, 1);
      renderWastes();
      renderComposer();
      save();
    },
    "Rien pour l'instant — touchez un déchet ci-dessous.",
    freshWaste,
  );
  freshWaste = null;
  $("frequentWaste").innerHTML = pickButtons(frequent(state.wasteFreq), list);
  const cats = categories();
  if (!activeCat || !cats.includes(activeCat)) activeCat = cats[0] || null;
  $("catTabs").innerHTML = cats
    .map(
      (c) =>
        `<button type="button" class="catTab" role="tab" data-cat="${esc(c)}" aria-selected="${c === activeCat}" tabindex="${c === activeCat ? 0 : -1}">${esc(shortCat(c))}</button>`,
    )
    .join("");
  $("catWaste").innerHTML = activeCat ? pickButtons(categoryItems(activeCat), list) : "";
}

/* ═════════════ Valider ═════════════ */

function renderPreview() {
  const c = state.current;
  const bp = buildBp(c);
  const num = state.editing != null ? state.editing + 1 : state.bps.length + 1;
  if (!bp) {
    $("ticketPreview").innerHTML = "";
    $("linePreview").textContent = "—";
    return;
  }
  $("ticketPreview").innerHTML = ticketHtml(bp, { num, address: adresseText(bp), preview: true });
  $("linePreview").textContent = mailLine(bp);
}

function saveBp() {
  const bp = buildBp(state.current);
  if (!bp) {
    toast(blockedMessage(3) || "Saisie incomplète.", null, "warn");
    return;
  }
  let index;
  const wasEditing = state.editing != null;
  if (wasEditing) {
    index = state.editing;
    state.bps[index] = bp;
    state.editing = null;
  } else {
    state.bps.push(bp);
    index = state.bps.length - 1;
    bp.wastes.forEach((w) => (state.wasteFreq[w] = (state.wasteFreq[w] || 0) + 1));
  }
  state.mailCustom = "";
  resetCurrent({ silent: true });
  hooks.changed({ fresh: wasEditing ? -1 : index });
  go("terrain", 1);
  const btn = $("stageNext");
  replay(btn, "is-done");
  setTimeout(() => btn.classList.remove("is-done"), 700);
  replay($("hudCount"), "is-ticking");
  replay($("navCount"), "is-ticking");
  toast(wasEditing ? `Bon n°${index + 1} mis à jour.` : `Bon n°${index + 1} enregistré.`, {
    label: "Rapport",
    onClick: () => go("rapport"),
  });
}

export function resetCurrent({ silent = false } = {}) {
  state.current = emptyCurrent();
  state.editing = null;
  $("streetInput").value = "";
  $("numeroRue").value = "";
  $("precCustom").value = "";
  $("wasteInput").value = "";
  $("sectorPicker").hidden = true;
  $("sectorTag").setAttribute("aria-expanded", "false");
  hideSuggestions($("streetSuggest"), $("streetInput"));
  hideSuggestions($("wasteSuggest"), $("wasteInput"));
  map.setTarget(null);
  map.focusSector(null);
  renderAllComposer();
  save();
  if (!silent) toast("Saisie effacée.");
}

/** Rouvre un BP enregistré dans le composeur, à l'identique. */
export function editBp(i) {
  const bp = state.bps[i];
  if (!bp) return;
  const rue = getStreets().find((r) => r.rue === bp.rue);
  const { keys, custom } = splitPrecisions(bp);
  state.editing = i;
  state.current = {
    rue: rue ? { rue: rue.rue, lon: rue.lon, lat: rue.lat, secteur: rue.secteur } : { rue: bp.rue, secteur: bp.secteur },
    numero: bp.numero || "",
    secteur: bp.secteur,
    secteurAuto: !rue || rue.secteur === bp.secteur,
    precisions: keys,
    precisionCustom: custom,
    wastes: [...(bp.wastes || [])],
  };
  $("streetInput").value = bp.rue;
  $("numeroRue").value = bp.numero || "";
  $("precCustom").value = custom;
  map.setTarget(bp.rue);
  renderAllComposer();
  hooks.changed({});
  go("terrain", 1);
  save();
  toast(`Modification du bon n°${i + 1}.`);
}

function cancelEdit() {
  const n = state.editing + 1;
  resetCurrent({ silent: true });
  hooks.changed({});
  go("terrain", 1);
  toast(`Modification du bon n°${n} annulée.`);
}

/* ═════════════ Rendu d'ensemble ═════════════ */

export function renderComposer() {
  const c = state.current;
  const editing = state.editing != null;
  const num = editing ? state.editing + 1 : state.bps.length + 1;
  const eyebrow = $("composerEyebrow");
  eyebrow.dataset.mode = editing ? "edit" : "new";
  eyebrow.firstChild.textContent = editing ? "Modification du bon " : "Nouveau bon de passage ";
  $("composerNum").textContent = "n°" + num;
  $("cancelEdit").hidden = !editing;

  // Étapes : faite / en cours / verrouillée
  const done = { 1: addressOk(c), 2: wastesOk(c), 3: false };
  document.querySelectorAll(".stageBtn").forEach((b) => {
    const n = +b.dataset.stageTarget;
    const current = n === state.stage;
    if (current) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
    b.toggleAttribute("data-done", done[n] && !current);
    b.setAttribute("aria-disabled", String(!canEnterStage(n)));
    const status = current ? "étape en cours" : done[n] ? "complétée" : canEnterStage(n) ? "à faire" : "verrouillée";
    b.setAttribute("aria-label", `Étape ${n}, ${b.querySelector(".stageName").textContent} — ${status}`);
  });

  // Barre d'action
  const next = $("stageNext");
  const back = $("stageBack");
  back.hidden = state.stage === 1;
  let label = "Continuer";
  let ready = true;
  let hint = "";
  if (state.stage === 1) {
    ready = addressOk(c);
    label = "Déchets";
    if (!ready) hint = c.rue ? "Choisissez le secteur pour continuer." : "Choisissez une rue : recherche, position ou carte.";
  } else if (state.stage === 2) {
    ready = wastesOk(c);
    label = "Vérifier";
    if (!ready) hint = "Ajoutez au moins un déchet pour continuer.";
    else hint = plural(c.wastes.length, "déchet relevé", "déchets relevés");
  } else {
    label = editing ? `Mettre à jour le bon n°${num}` : `Enregistrer le bon n°${num}`;
  }
  $("stageNextLabel").textContent = label;
  next.setAttribute("aria-disabled", String(!ready));
  next.classList.toggle("btn--signal", state.stage === 3);
  next.classList.toggle("btn--primary", state.stage !== 3);
  next.querySelector("use").setAttribute("href", state.stage === 3 ? "#i-check" : "#i-arrow-right");
  $("stageHint").textContent = hint;

  // Même adresse
  const last = state.bps[state.bps.length - 1];
  const dup = $("duplicateLast");
  dup.hidden = !last || editing || !!c.rue;
  if (last) $("duplicateLastLabel").textContent = `Même adresse que n°${state.bps.length}`;

  $("mapHint").classList.toggle("is-hidden", !!c.rue || state.bps.length > 0);
  if (state.stage === 3) renderPreview();
}

export function renderAllComposer() {
  renderPlace();
  renderPrecisions();
  renderWastes();
  renderComposer();
}

/* ═════════════ Liaisons ═════════════ */

export function initComposer(opts = {}) {
  hooks = { ...hooks, ...opts };

  // Rue
  const streetInput = $("streetInput");
  streetInput.addEventListener("input", () => {
    $("streetClear").hidden = !streetInput.value;
    if (state.current.rue && streetInput.value !== state.current.rue.rue) {
      state.current.rue = null;
      state.current.secteur = null;
      map.setTarget(null, { fly: false });
      renderPlace();
      renderComposer();
    }
    showStreetSuggest(streetInput.value, (r) => chooseRue(r));
  });
  streetInput.addEventListener("focus", () => {
    if (streetInput.value && !state.current.rue) showStreetSuggest(streetInput.value, (r) => chooseRue(r));
  });
  bindComboKeys(streetInput, $("streetSuggest"));
  $("streetClear").onclick = clearRue;
  $("locateBtn").onclick = () => useMyPosition($("locateBtn"));
  $("mapLocate").onclick = () => useMyPosition($("mapLocate"));
  $("duplicateLast").onclick = duplicateLastAddress;

  // Secteur
  $("sectorPicker").innerHTML = SECTEURS.map(
    (s) => `<button type="button" class="sectorOpt" role="radio" data-s="${s}" style="${secStyle(s)}" aria-checked="false">${s}</button>`,
  ).join("");
  $("sectorPicker").querySelectorAll(".sectorOpt").forEach((b) => {
    b.onclick = () => setSector(b.dataset.s, false);
    b.onkeydown = (e) => {
      const i = SECTEURS.indexOf(b.dataset.s);
      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const s = SECTEURS[(i + d + SECTEURS.length) % SECTEURS.length];
      setSector(s, false);
      $("sectorPicker").querySelector(`[data-s="${s}"]`).focus();
    };
  });
  $("sectorTag").onclick = () => {
    const open = $("sectorPicker").hidden;
    $("sectorPicker").hidden = !open;
    $("sectorTag").setAttribute("aria-expanded", String(open));
  };

  // Numéro
  let numTimer;
  $("numeroRue").addEventListener("input", (e) => {
    state.current.numero = e.target.value.replace(/[^\d a-zA-Z/-]/g, "").slice(0, 8);
    if (e.target.value !== state.current.numero) e.target.value = state.current.numero;
    renderComposer();
    save();
    clearTimeout(numTimer);
    numTimer = setTimeout(refineSector, 450);
  });
  $("numeroRue").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });

  // Emplacement précis
  document.querySelectorAll("#precField .toggle").forEach((b) => {
    b.onclick = () => {
      const list = state.current.precisions;
      const i = list.indexOf(b.dataset.key);
      i >= 0 ? list.splice(i, 1) : list.push(b.dataset.key);
      renderPrecisions();
      renderComposer();
      save();
    };
  });
  $("precCustom").addEventListener("input", (e) => {
    state.current.precisionCustom = e.target.value;
    save();
  });

  // Déchets
  const wasteInput = $("wasteInput");
  wasteInput.addEventListener("input", () => showWasteSuggest(wasteInput.value, addWaste));
  bindComboKeys(wasteInput, $("wasteSuggest"), () => addWaste(wasteInput.value));
  $("addWaste").onclick = () => {
    if (!wasteInput.value.trim()) {
      wasteInput.focus();
      return toast("Tapez un déchet, ou touchez-en un ci-dessous.");
    }
    addWaste(wasteInput.value);
  };
  const pickHandler = (e) => {
    const b = e.target.closest(".pick");
    if (b) toggleWaste(b.dataset.w);
  };
  $("frequentWaste").addEventListener("click", pickHandler);
  $("catWaste").addEventListener("click", pickHandler);
  $("catTabs").addEventListener("click", (e) => {
    const t = e.target.closest(".catTab");
    if (!t) return;
    activeCat = t.dataset.cat;
    renderWastes();
    $("catTabs").querySelector(`[data-cat="${CSS.escape(activeCat)}"]`)?.focus();
  });
  $("catTabs").addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const cats = categories();
    activeCat = cats[(cats.indexOf(activeCat) + d + cats.length) % cats.length];
    renderWastes();
    const tab = $("catTabs").querySelector(`[data-cat="${CSS.escape(activeCat)}"]`);
    tab?.focus();
    tab?.scrollIntoView({ inline: "nearest", block: "nearest" });
  });

  // Étapes & barre d'action
  document.querySelectorAll(".stageBtn").forEach((b) => {
    b.onclick = () => {
      const r = go("terrain", +b.dataset.stageTarget);
      if (typeof r === "string") showBlocked(r);
    };
  });
  $("stageBack").onclick = () => go("terrain", Math.max(1, state.stage - 1));
  $("stageNext").onclick = () => {
    if (state.stage === 3) return saveBp();
    const r = go("terrain", state.stage + 1);
    if (typeof r === "string") showBlocked(r);
  };
  $("cancelEdit").onclick = cancelEdit;

  onRoute((view) => {
    renderComposer();
    if (view === "terrain" && state.stage === 3) renderPreview();
  });

  // Mobile : pendant la frappe, la carte se replie pour laisser place au clavier.
  const small = window.matchMedia("(max-width: 1023px)");
  const panel = $("panel");
  panel.addEventListener("focusin", (e) => {
    if (small.matches && e.target.matches("input:not([type=checkbox]):not([type=file]), textarea")) {
      $("app").classList.add("is-typing");
    }
  });
  panel.addEventListener("focusout", () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || !a.matches || !a.matches("input, textarea")) $("app").classList.remove("is-typing");
    }, 120);
  });

  // Ferme les suggestions en touchant ailleurs
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".combo")) {
      hideSuggestions($("streetSuggest"), streetInput);
      hideSuggestions($("wasteSuggest"), wasteInput);
    }
  });
}

function showBlocked(msg) {
  $("stageHint").textContent = msg;
  replay($("stageHint"), "is-ticking");
  toast(msg, null, "warn");
}
