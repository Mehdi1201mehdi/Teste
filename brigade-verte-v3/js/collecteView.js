// Vue « Collecte » : recherche du jour de collecte (ordures ménagères + poubelle
// jaune) à une adresse d'Amiens ou dans une commune de la métropole.
// Recherche de rue instantanée et hors ligne (liste locale des 1 437 rues) ;
// une seule requête réseau par rue choisie, puis cache de 7 jours.
// Les règles (semaines ISO, fériés, reports, cache) sont dans collecte.js :
// cette vue ne fait qu'afficher ce que le moteur calcule, sans rien inventer.

import { $, esc, highlight } from "./utils.js";
import { fuzzySearch } from "./search.js";
import { showSuggestions, hideSuggestions, bindComboKeys } from "./components.js";
import { getStreets } from "./streets.js";
import { secStyle } from "./sectors.js";
import { go, onRoute } from "./router.js";
import * as map from "./map.js";
import {
  lookupStreet,
  lookupCommune,
  groupBySchedule,
  nextPickup,
  parseSchedule,
  relDay,
  weekParity,
  isoWeek,
  parseNumero,
  OFFICIAL_URL,
} from "./collecte.js";

const RECENT_KEY = "bv_collecte_recent";
let hooks = { useAddress: null };
let current = null; // { kind: "rue"|"commune", rue?, commune? }
let reqId = 0;
let renderedDay = ""; // jour du dernier calcul (« aujourd'hui » change à minuit)

const icon = (id, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"></use></svg>`;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const weekLabel = (d = new Date()) => `Semaine ${isoWeek(d)} — ${weekParity(d)}`;

/* ─── Recherches récentes (terrain : on revient souvent sur les mêmes rues) ─── */
function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 6);
  } catch {
    return [];
  }
}
function pushRecent(entry) {
  const list = readRecent().filter((e) => !(e.kind === entry.kind && e.name === entry.name && e.num === entry.num));
  list.unshift(entry);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* stockage indisponible */
  }
  renderRecent();
}
function renderRecent() {
  const box = $("colRecent");
  const list = readRecent();
  box.hidden = !list.length || !!current;
  box.innerHTML = list.length
    ? `<span class="label" id="colRecentLabel">Recherches récentes</span><div class="colRecentList" role="group" aria-labelledby="colRecentLabel">${list
        .map(
          (e, i) =>
            `<button type="button" class="chipBtn colChip" data-i="${i}">${icon(e.kind === "commune" ? "map-pin" : "rotate")}<span>${esc((e.num ? e.num + " " : "") + e.name)}</span>${e.kind === "commune" ? " <small>commune</small>" : ""}</button>`,
        )
        .join("")}</div>`
    : "";
  box.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => {
      const e = list[+b.dataset.i];
      $("colNum").value = e.num || "";
      if (e.kind === "commune") chooseCommune(e.name);
      else {
        const rue = getStreets().find((r) => r.rue === e.name);
        if (rue) chooseStreet(rue);
      }
    };
  });
}

/* ─── État d'accueil (aucune recherche) ─── */
function renderIdle() {
  const box = $("colEmpty");
  if (!box) return;
  box.hidden = !!current;
  const note = $("colEmptyNote");
  if (note) {
    note.hidden = navigator.onLine !== false;
    note.innerHTML = `${icon("wifi-off")}<span>Hors connexion : seules les rues déjà consultées sur cet appareil (7 derniers jours) sont disponibles.</span>`;
  }
}

function setHelp(msg) {
  const h = $("colHelp");
  if (!h) return;
  h.textContent = msg || "";
  h.hidden = !msg;
  $("colInput").setAttribute("aria-invalid", msg ? "true" : "false");
}

/* ─── Suggestions : rues d'Amiens + « commune » ─── */
function suggest(q) {
  const box = $("colSuggest");
  const input = $("colInput");
  $("colClear").hidden = !input.value;
  if (q.trim().length >= 2) setHelp("");
  if (q.trim().length < 2) return hideSuggestions(box, input);
  const rues = fuzzySearch(getStreets(), q, (r) => r.rue, 8).map((r) => ({
    html: `<span class="sugName">${highlight(r.rue, q)}</span><span class="sectorChip" style="${secStyle(r.secteur)}">${esc(r.secteur || "?")}</span>`,
    onClick: () => chooseStreet(r),
  }));
  const entries = [...rues];
  // Hors Amiens : on propose toujours de chercher le texte comme une commune.
  if (q.trim().length >= 3 && !/\d/.test(q)) {
    const name = q.trim().replace(/\s+/g, " ");
    entries.push({
      html: `<span class="sugName">Commune « ${esc(name)} »</span><span class="sugMeta">hors Amiens</span>`,
      onClick: () => chooseCommune(name),
    });
  }
  showSuggestions(box, entries, "Aucune rue trouvée.");
}

function chooseStreet(rue) {
  current = { kind: "rue", rue };
  $("colInput").value = rue.rue;
  hideSuggestions($("colSuggest"), $("colInput"));
  $("colClear").hidden = false;
  setHelp("");
  map.setTarget(rue.rue);
  run();
}

function chooseCommune(name) {
  current = { kind: "commune", commune: name };
  $("colInput").value = name;
  hideSuggestions($("colSuggest"), $("colInput"));
  $("colClear").hidden = false;
  setHelp("");
  map.setTarget(null);
  run();
}

/* ─── Rendu ─── */
const fmtTime = (t) =>
  new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(" ", " à ");
const fmtDay = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });

/** Ligne « Prochain passage » et éventuel avertissement de jour férié. */
function nextHtml(schedule, commune) {
  if (!schedule) return { html: "", today: false };
  const next = nextPickup(schedule, new Date(), { commune });
  if (!next) {
    return {
      html: `<p class="colNext colNext--none">Prochain passage non calculé : vérifiez sur amiens.fr.</p>`,
      today: false,
    };
  }
  const rel = relDay(next.date);
  const full = fmtDay(next.date);
  if (next.unsure) {
    // Férié non collecté dont le report n'est pas défini : on n'invente pas de date.
    return {
      html: `<p class="colNext colNext--unsure">Jour prévu : <b>${esc(full)}</b> (férié, non collecté)</p>
        <p class="colWarn"><span class="colBadge colBadge--warn">${icon("alert")}Férié — à vérifier</span><span>Le report de ce jour n'est pas fixé par la règle publiée : vérifiez sur amiens.fr.</span></p>`,
      today: false,
    };
  }
  const today = rel === "aujourd'hui";
  const when = today ? "aujourd'hui" : rel === "demain" ? `demain, ${full}` : full;
  return {
    html: `<p class="colNext">Prochain passage : <b>${esc(when)}</b></p>${
      next.moved
        ? `<p class="colWarn"><span class="colBadge colBadge--warn">${icon("alert")}Reporté</span><span>Jour férié non collecté : passage reporté ${commune ? "au lendemain" : "au mercredi de la même semaine"}.</span></p>`
        : ""
    }`,
    today,
  };
}

function streamCard(kind, schedule, commune = false) {
  const label = kind === "om" ? "Ordures ménagères" : "Poubelle jaune";
  const { days, parity } = parseSchedule(schedule);
  const n = nextHtml(schedule, commune);
  const parityLine = parity
    ? `<p class="colParity">1 semaine sur 2 · semaines ${parity}s${weekParity() === parity ? " (comme cette semaine)" : " (pas cette semaine)"}</p>`
    : "";
  return `<section class="colStream colStream--${kind}${n.today ? " is-today" : ""}" aria-label="${label}">
    <div class="colStream__head">
      <span class="bin bin--${kind}" aria-hidden="true"></span>
      <h4 class="colStream__title">${label}</h4>
      ${n.today ? `<span class="colBadge colBadge--today">${icon("check")}Aujourd'hui</span>` : ""}
    </div>
    <p class="colDays${days.length ? "" : " colDays--none"}">${esc(schedule || "Non communiqué")}</p>
    ${parityLine}
    ${n.html}
  </section>`;
}

const streams = (om, tri, commune = false) =>
  `<div class="colStreams">${streamCard("om", om, commune)}${streamCard("tri", tri, commune)}</div>`;

function sourceLine(res) {
  const offline = res.offlineFallback || (res.fromCache && navigator.onLine === false);
  const badges = [
    offline ? `<span class="colBadge colBadge--warn">${icon("wifi-off")}Hors connexion</span>` : "",
    res.stale ? `<span class="colBadge colBadge--warn">Données de plus de 7 jours</span>` : "",
  ].join("");
  const where = res.fromCache ? " · gardées sur l'appareil" : "";
  return `<p class="colMeta">${badges}<span>Source : Amiens Métropole · données du ${esc(fmtTime(res.at))}${where}</span></p>`;
}

function cardHead(title, tag) {
  return `<header class="colCard__head"><h3>${title}</h3>${tag || ""}</header>`;
}

function officialLink(label = "Vérifier sur amiens.fr") {
  return `<a class="btn btn--ghost colOfficialLink" href="${OFFICIAL_URL}" target="_blank" rel="noopener">${icon("external")}<span>${label}</span><span class="visually-hidden"> (nouvel onglet)</span></a>`;
}

function skeleton(title) {
  return `<article class="colCard is-loading" aria-busy="true">
    ${cardHead(esc(title))}
    <p class="colMeta"><span class="colSpinner" aria-hidden="true"></span><span>Interrogation d'Amiens Métropole…</span></p>
    <div class="colStreams" aria-hidden="true">
      <div class="colStream colStream--sk"><div class="sk sk--line"></div><div class="sk sk--big"></div><div class="sk sk--line"></div></div>
      <div class="colStream colStream--sk"><div class="sk sk--line"></div><div class="sk sk--big"></div><div class="sk sk--line"></div></div>
    </div>
  </article>`;
}

function errorCard(msg) {
  const offline = navigator.onLine === false || /^Hors connexion/.test(msg);
  return `<article class="colCard colCard--error${offline ? " colCard--offline" : ""}" role="alert">
    <div class="colState">
      <span class="colState__icon">${icon(offline ? "wifi-off" : "alert")}</span>
      <div>
        <h3>${offline ? "Hors connexion" : "Jour de collecte indisponible"}</h3>
        <p>${esc(msg)}</p>
        <p class="colState__hint">Aucun jour n'est affiché tant que la source n'a pas répondu.</p>
      </div>
    </div>
    <div class="colActions">
      <button type="button" class="btn btn--primary" id="colRetry">${icon("rotate")}<span>Réessayer</span></button>
      ${officialLink("Site d'Amiens Métropole").replace("btn--ghost", "btn--secondary")}
    </div>
  </article>`;
}

function useButton(rue, num) {
  if (!hooks.useAddress) return "";
  const where = num ? `au ${num} ${rue.rue}` : `dans la rue ${rue.rue}`;
  return `<button type="button" class="btn btn--primary colUse" id="colUse" aria-label="Relever un dépôt ici, ${esc(where)}">${icon("plus")}<span>Relever un dépôt ici</span></button>`;
}

function cardFoot(rue, num) {
  return `<div class="colCard__foot">${rue ? useButton(rue, num) : ""}${officialLink()}</div>`;
}

const streetTag = (rue) =>
  rue.secteur ? `<span class="sectorChip" style="${secStyle(rue.secteur)}">${esc(rue.secteur)}</span>` : "";

function renderStreet(res, rue, numRaw) {
  const box = $("colResult");
  const num = parseNumero(numRaw) ? numRaw.trim() : "";
  if (!res.exact.length) {
    const near = res.near || [];
    box.innerHTML = `<article class="colCard colCard--empty">
      ${cardHead(esc(rue.rue), streetTag(rue))}
      ${res.at ? sourceLine(res) : ""}
      <p>${
        near.length
          ? "Cette voie n'apparaît pas telle quelle dans le fichier d'Amiens Métropole. Voies proches :"
          : "Aucune adresse d'habitation n'est référencée pour cette voie (passerelle, parc, zone d'activité…)."
      }</p>
      ${near.length ? `<div class="colNear">${near.map((v, i) => `<button type="button" class="chipBtn" data-near="${i}">${esc(v)}</button>`).join("")}</div>` : ""}
      <div class="colCard__foot">${officialLink()}</div>
    </article>`;
    box.querySelectorAll("[data-near]").forEach((b) => {
      b.onclick = () => {
        const v = near[+b.dataset.near];
        renderStreet({ ...res, exact: res.rows.filter((r) => r.voie === v), near: [] }, { ...rue, rue: v }, numRaw);
      };
    });
    return;
  }

  // Numéro précis
  if (num) {
    const row = res.row || res.exact.find((r) => String(+r.n) === parseNumero(num).n);
    if (row) {
      box.innerHTML = `<article class="colCard colCard--hit">
        ${cardHead(`<span class="colNum mono">${esc(num)}</span> ${esc(rue.rue)}`, streetTag(rue))}
        ${sourceLine(res)}
        ${streams(row.om, row.tri)}
        ${cardFoot(rue, num)}
      </article>`;
      bindUse(rue, num);
      return;
    }
  }

  const groups = groupBySchedule(res.exact);
  const single = groups.length === 1;
  box.innerHTML = `<article class="colCard">
    ${cardHead(esc(rue.rue), streetTag(rue))}
    ${sourceLine(res)}
    ${num ? `<p class="colNote">${icon("alert")}<span>Le n° ${esc(num)} n'est pas dans le fichier d'Amiens Métropole : voici toute la rue.</span></p>` : ""}
    ${
      single
        ? `<p class="colAll">Même calendrier pour toute la rue.</p>${streams(groups[0].om, groups[0].tri)}`
        : `<p class="colAll"><b>${groups.length} calendriers selon le numéro</b> — indiquez le n° pour aller plus vite.</p>
           ${groups
             .map(
               (g) => `<section class="colGroup">
                 <div class="colRanges"><span class="colRanges__label">Numéros</span>${g.ranges.map((r) => `<span class="colRange mono">${esc(r)}</span>`).join("")}</div>
                 ${streams(g.om, g.tri)}
               </section>`,
             )
             .join("")}`
    }
    ${cardFoot(rue, "")}
  </article>`;
  bindUse(rue, "");
}

function bindUse(rue, num) {
  const b = $("colUse");
  if (b) b.onclick = () => hooks.useAddress?.(rue, num);
}

function renderCommune(res, name) {
  const box = $("colResult");
  const row = res.rows[0];
  const tag = `<span class="colTag">Commune</span>`;
  if (!row) {
    box.innerHTML = `<article class="colCard colCard--empty">
      ${cardHead(esc(name), tag)}
      <p>Commune introuvable dans Amiens Métropole. Vérifiez l'orthographe (ex. « Longueau », « Saint-Fuscien »), ou cherchez une rue d'Amiens.</p>
      <div class="colCard__foot">${officialLink()}</div>
    </article>`;
    return;
  }
  box.innerHTML = `<article class="colCard colCard--hit">
    ${cardHead(esc(name), tag)}
    ${sourceLine(res)}
    ${streams(row.om, row.tri, true)}
    ${cardFoot(null)}
  </article>`;
}

/* ─── Recherche ─── */
async function run({ force = false } = {}) {
  if (!current) return;
  const id = ++reqId;
  const numRaw = $("colNum").value;
  $("colRecent").hidden = true;
  renderIdle();
  renderedDay = dayKey();
  const title = current.kind === "rue" ? current.rue.rue : current.commune;
  const box = $("colResult");
  // Squelette seulement si la réponse n'est pas immédiate (cache).
  const slow = setTimeout(() => {
    if (id !== reqId) return;
    box.innerHTML = skeleton(title);
    box.setAttribute("aria-busy", "true");
  }, 120);
  try {
    if (current.kind === "rue") {
      const res = await lookupStreet(current.rue.rue, numRaw, { force });
      if (id !== reqId) return;
      renderStreet(res, current.rue, numRaw);
      pushRecent({ kind: "rue", name: current.rue.rue, num: numRaw.trim() });
    } else {
      const res = await lookupCommune(current.commune, { force });
      if (id !== reqId) return;
      renderCommune(res, current.commune);
      if (res.rows.length) pushRecent({ kind: "commune", name: current.commune, num: "" });
    }
  } catch (e) {
    if (id !== reqId) return;
    box.innerHTML = errorCard(e.message);
    $("colRetry").onclick = () => run({ force: true });
  } finally {
    clearTimeout(slow);
    if (id === reqId) box.removeAttribute("aria-busy");
  }
}

function clear() {
  current = null;
  reqId++;
  $("colInput").value = "";
  $("colNum").value = "";
  $("colClear").hidden = true;
  $("colResult").innerHTML = "";
  $("colResult").removeAttribute("aria-busy");
  setHelp("");
  hideSuggestions($("colSuggest"), $("colInput"));
  renderRecent();
  renderIdle();
  $("colInput").focus();
}

/** Bouton « Rechercher » : relance la recherche, ou prend la 1re suggestion. */
function submit() {
  const input = $("colInput");
  const q = input.value.trim();
  if (current && input.value === (current.rue?.rue || current.commune)) return run();
  if (q.length < 2) {
    setHelp("Saisissez au moins 2 lettres d'une rue d'Amiens ou d'une commune.");
    input.focus();
    return;
  }
  suggest(input.value);
  const first = $("colSuggest").querySelector(".sug");
  if (first) first.click();
  else {
    setHelp("Aucune rue ne correspond : vérifiez l'orthographe.");
    input.focus();
  }
}

function refreshWeek() {
  const now = new Date();
  $("colWeek").textContent = `Cette semaine : n° ${isoWeek(now)}, ${weekParity(now)}.`;
  const pill = $("colWeekNow");
  if (pill) pill.textContent = weekLabel(now);
  const sum = $("colRulesWeek");
  if (sum) sum.textContent = weekLabel(now);
}

export function initCollecte(opts = {}) {
  hooks = { ...hooks, ...opts };
  const input = $("colInput");
  $("colOfficial").href = OFFICIAL_URL;
  refreshWeek();
  input.addEventListener("input", () => {
    if (current && input.value !== (current.rue?.rue || current.commune)) current = null;
    suggest(input.value);
  });
  input.addEventListener("focus", () => input.value && !current && suggest(input.value));
  input.addEventListener("blur", () => setTimeout(() => document.activeElement !== input && hideSuggestions($("colSuggest"), input), 150));
  bindComboKeys(input, $("colSuggest"), () => {
    const first = $("colSuggest").querySelector(".sug");
    first?.click();
  });
  $("colClear").onclick = clear;
  let t;
  $("colNum").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^\d a-zA-Z]/g, "").slice(0, 10);
    clearTimeout(t);
    t = setTimeout(() => current && run(), 350);
  });
  $("colNum").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
      current && run();
    }
  });
  $("colForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  window.addEventListener("online", renderIdle);
  window.addEventListener("offline", renderIdle);
  renderRecent();
  renderIdle();
  onRoute((view) => {
    if (view !== "collecte") return;
    refreshWeek();
    if (current?.kind === "rue") map.setTarget(current.rue.rue, { fly: false });
    // Vue restée ouverte après minuit : « aujourd'hui » et les reports sont recalculés (cache, sans réseau).
    if (current && renderedDay && renderedDay !== dayKey()) run();
  });
}

/** Ouvre la vue Collecte sur une adresse (depuis la carte « lieu » du Terrain). */
export function openCollecte(rue, num = "") {
  $("colNum").value = num || "";
  go("collecte");
  chooseStreet(rue);
}
