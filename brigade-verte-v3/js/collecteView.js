// Vue « Collecte » : recherche du jour de collecte (ordures ménagères + poubelle
// jaune) à une adresse d'Amiens ou dans une commune de la métropole.
// Recherche de rue instantanée et hors ligne (liste locale des 1 437 rues) ;
// une seule requête réseau par rue choisie, puis cache de 7 jours.

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
    ? `<span class="label">Récemment</span><div class="colRecentList">${list
        .map(
          (e, i) =>
            `<button type="button" class="chipBtn" data-i="${i}">${esc((e.num ? e.num + " " : "") + e.name)}${e.kind === "commune" ? " <small>commune</small>" : ""}</button>`,
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

/* ─── Suggestions : rues d'Amiens + « commune » ─── */
function suggest(q) {
  const box = $("colSuggest");
  const input = $("colInput");
  $("colClear").hidden = !input.value;
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
  input.setAttribute("aria-expanded", "true");
}

function chooseStreet(rue) {
  current = { kind: "rue", rue };
  $("colInput").value = rue.rue;
  hideSuggestions($("colSuggest"), $("colInput"));
  $("colClear").hidden = false;
  map.setTarget(rue.rue);
  run();
}

function chooseCommune(name) {
  current = { kind: "commune", commune: name };
  $("colInput").value = name;
  hideSuggestions($("colSuggest"), $("colInput"));
  $("colClear").hidden = false;
  map.setTarget(null);
  run();
}

/* ─── Rendu ─── */
const fmtTime = (t) =>
  new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(" ", "\u00a0à\u00a0");

function streamRow(kind, schedule, commune) {
  const label = kind === "om" ? "Ordures ménagères" : "Poubelle jaune";
  const next = nextPickup(schedule, new Date(), { commune });
  const when = next ? relDay(next.date) : null;
  const today = when === "aujourd'hui";
  return `<div class="colStream colStream--${kind}${today ? " is-today" : ""}">
    <span class="bin bin--${kind}" aria-hidden="true"></span>
    <div class="colStreamText"><b>${label}</b><span>${esc(schedule || "Non communiqué")}</span></div>
    ${
      when
        ? `<span class="colNext${today ? " is-today" : ""}"><small>Prochain passage</small>${esc(when)}${next.moved ? ' <em title="Jour férié : collecte reportée">reportée</em>' : ""}</span>`
        : ""
    }
  </div>`;
}

function sourceLine(res) {
  const bits = [`Amiens Métropole · données du ${fmtTime(res.at)}`];
  if (res.offlineFallback) bits.unshift("Hors connexion");
  return `<p class="colMeta mono">${esc(bits.join(" · "))}</p>`;
}

function skeleton(title) {
  return `<article class="colCard is-loading" aria-busy="true">
    <h3>${esc(title)}</h3>
    <p class="colMeta mono">Interrogation d'Amiens Métropole…</p>
    <div class="sk"></div><div class="sk"></div>
  </article>`;
}

function errorCard(msg) {
  return `<article class="colCard colCard--error" role="alert">
    <h3>Impossible d'obtenir le jour de collecte</h3>
    <p>${esc(msg)}</p>
    <div class="colActions">
      <button type="button" class="btn btn--primary" id="colRetry">Réessayer</button>
      <a class="btn btn--line" href="${OFFICIAL_URL}" target="_blank" rel="noopener">Site d'Amiens Métropole</a>
    </div>
  </article>`;
}

function useButton(rue, num) {
  if (!hooks.useAddress) return "";
  return `<button type="button" class="linkBtn colUse" id="colUse"><svg class="icon" aria-hidden="true"><use href="#i-plus"></use></svg>Relever un dépôt ${num ? "au " + esc(num) + " " : "dans cette rue"}</button>`;
}

function renderStreet(res, rue, numRaw) {
  const box = $("colResult");
  const num = parseNumero(numRaw) ? numRaw.trim() : "";
  if (!res.exact.length) {
    const near = res.near || [];
    box.innerHTML = `<article class="colCard colCard--empty">
      <h3>${esc(rue.rue)}</h3>
      <p>${
        near.length
          ? "Cette voie n'apparaît pas telle quelle dans le fichier d'Amiens Métropole. Voies proches :"
          : "Aucune adresse d'habitation n'est référencée pour cette voie (passerelle, parc, zone d'activité…)."
      }</p>
      ${near.length ? `<div class="colNear">${near.map((v, i) => `<button type="button" class="chipBtn" data-near="${i}">${esc(v)}</button>`).join("")}</div>` : ""}
      <a class="linkBtn" href="${OFFICIAL_URL}" target="_blank" rel="noopener"><svg class="icon" aria-hidden="true"><use href="#i-external"></use></svg>Vérifier sur amiens.fr</a>
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
        <h3>${esc(num)} ${esc(rue.rue)}</h3>
        ${sourceLine(res)}
        ${streamRow("om", row.om)}
        ${streamRow("tri", row.tri)}
        ${useButton(rue, num)}
      </article>`;
      bindUse(rue, num);
      return;
    }
  }

  const groups = groupBySchedule(res.exact);
  const single = groups.length === 1;
  box.innerHTML = `<article class="colCard">
    <h3>${esc(rue.rue)}</h3>
    ${sourceLine(res)}
    ${num ? `<p class="colNote">Le n° ${esc(num)} n'est pas dans le fichier : voici toute la rue.</p>` : ""}
    ${
      single
        ? `<p class="colAll">Même calendrier pour toute la rue.</p>${streamRow("om", groups[0].om)}${streamRow("tri", groups[0].tri)}`
        : `<p class="colAll">${groups.length} calendriers selon le numéro — précisez le n° pour aller plus vite.</p>
           ${groups
             .map(
               (g) => `<section class="colGroup">
                 <div class="colRanges">${g.ranges.map((r) => `<span>${esc(r)}</span>`).join("")}</div>
                 ${streamRow("om", g.om)}${streamRow("tri", g.tri)}
               </section>`,
             )
             .join("")}`
    }
    ${useButton(rue, "")}
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
  if (!row) {
    box.innerHTML = `<article class="colCard colCard--empty">
      <h3>${esc(name)}</h3>
      <p>Commune introuvable dans Amiens Métropole. Vérifiez l'orthographe (ex. « Longueau », « Saint-Fuscien »), ou cherchez une rue d'Amiens.</p>
    </article>`;
    return;
  }
  box.innerHTML = `<article class="colCard colCard--hit">
    <h3>${esc(name)} <small>commune</small></h3>
    ${sourceLine(res)}
    ${streamRow("om", row.om, true)}
    ${streamRow("tri", row.tri, true)}
  </article>`;
}

/* ─── Recherche ─── */
async function run({ force = false } = {}) {
  if (!current) return;
  const id = ++reqId;
  const numRaw = $("colNum").value;
  $("colRecent").hidden = true;
  const title = current.kind === "rue" ? current.rue.rue : current.commune;
  const box = $("colResult");
  // Squelette seulement si la réponse n'est pas immédiate (cache).
  const slow = setTimeout(() => id === reqId && (box.innerHTML = skeleton(title)), 120);
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
  }
}

function clear() {
  current = null;
  reqId++;
  $("colInput").value = "";
  $("colNum").value = "";
  $("colClear").hidden = true;
  $("colResult").innerHTML = "";
  hideSuggestions($("colSuggest"), $("colInput"));
  renderRecent();
  $("colInput").focus();
}

export function initCollecte(opts = {}) {
  hooks = { ...hooks, ...opts };
  const input = $("colInput");
  $("colOfficial").href = OFFICIAL_URL;
  $("colWeek").textContent = `Cette semaine : n° ${isoWeek(new Date())}, ${weekParity()}.`;
  input.addEventListener("input", () => {
    if (current && input.value !== (current.rue?.rue || current.commune)) current = null;
    suggest(input.value);
  });
  input.addEventListener("focus", () => input.value && !current && suggest(input.value));
  input.addEventListener("blur", () => setTimeout(() => hideSuggestions($("colSuggest"), input), 150));
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
  $("colForm").addEventListener("submit", (e) => e.preventDefault());
  renderRecent();
  onRoute((view) => {
    if (view === "collecte" && current?.kind === "rue") map.setTarget(current.rue.rue, { fly: false });
  });
}

/** Ouvre la vue Collecte sur une adresse (depuis la carte « lieu » du Terrain). */
export function openCollecte(rue, num = "") {
  $("colNum").value = num || "";
  go("collecte");
  chooseStreet(rue);
}
