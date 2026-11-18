// Tableau de bord (vue Accueil) : l'état de la tournée en un coup d'œil.
// Contrat (app.js) : initDashboard({ edit, reveal }) une fois au démarrage —
// construit la structure ; renderDashboard() à chaque changement de la
// tournée — ne met à jour que les parties dynamiques.
// Aucune donnée inventée : tout vient de state.bps (1 bon = 1 dépôt) ; une
// heure n'est affichée que si le bon porte un horodatage réel (createdAt).

import { state } from "./storage.js";
import { SECTEURS, TITRE, secStyle } from "./sectors.js";
import { adresseText } from "./bp.js";
import { bpWhen, esc, plural, dateFr, todayISO } from "./utils.js";
import { dateLongue } from "./phrase.js";
import { onRoute } from "./router.js";

const hooks = { edit: () => {}, reveal: () => {} };
let root = null;
let refs = {};
let recentSig = "";
let sectorSig = "";

const RECENT_MAX = 5;
const SEC_NAME = { CENTRE: "Centre", OUEST: "Ouest", NORD: "Nord", EST: "Est", SUD: "Sud" };

const icon = (id, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"></use></svg>`;
// Triangle d'alerte en ligne : ne dépend pas de l'ajout de « i-alert » au sprite.
const ALERT_SVG = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

const upperFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase("fr") + s.slice(1) : s);

/** Jour local (AAAA-MM-JJ) d'un horodatage ISO, ou "" s'il est absent ou invalide. */
function dayOf(iso) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** « Matelas, canapé, sac poubelle » : les sigles (DEEE, PAV…) gardent leurs capitales. */
function wasteText(wastes) {
  return (wastes || [])
    .map((w, k) => {
      const s = String(w || "").trim();
      if (k === 0 || s.length < 2 || s.charAt(1) !== s.charAt(1).toLocaleLowerCase("fr")) return s;
      return s.charAt(0).toLocaleLowerCase("fr") + s.slice(1);
    })
    .filter(Boolean)
    .join(", ");
}

const setText = (el, txt) => {
  if (el && el.textContent !== txt) el.textContent = txt;
};

/* ═════════════ Structure (construite une fois) ═════════════ */

function statHtml(key, label) {
  return `<div class="stat" data-stat="${key}">
      <p class="stat__label">${label}</p>
      <p class="stat__value" data-v>0</p>
      <p class="stat__meta" data-m></p>
    </div>`;
}

function build() {
  root.innerHTML = `
  <div class="dash" id="dashScroll">
    <div class="dash__inner">

      <header class="dashDay dash-in" style="--d:0">
        <p class="dashEyebrow">Accueil · tournée du jour</p>
        <h2 class="dashTitle" id="dashTitle"><span class="visually-hidden">Accueil — </span><span data-r="today"></span></h2>
        <p class="dashTourDate" data-r="tourDate" hidden></p>
        <div class="dashPills">
          <p class="pill" id="homeTourState" data-r="tour"></p>
          <p class="pill pill--ok" id="homeSave">${icon("i-check")}<span data-r="save"></span></p>
        </div>
        <div class="dashAlert" data-r="alert" role="status" hidden>
          <span class="dashAlert__icon">${ALERT_SVG}</span>
          <div class="dashAlert__body">
            <p class="dashAlert__title">Tournée précédente non clôturée</p>
            <p class="dashAlert__text" data-r="alertText"></p>
            <div class="dashAlert__actions">
              <button type="button" class="btn btn--warn" data-view-target="rapport">${icon("i-file")}<span>Envoyer puis clôturer</span></button>
              <button type="button" class="btn btn--ghost" data-r="alertDate">${icon("i-calendar")}<span>Changer la date du rapport</span></button>
            </div>
          </div>
        </div>
      </header>

      <section class="dashBlock" aria-labelledby="homeStatsTitle">
        <h3 class="visually-hidden" id="homeStatsTitle">Chiffres de la tournée</h3>
        <div class="statGrid" id="homeStats">
          ${statHtml("deposits", "Dépôts relevés")}
          ${statHtml("sectors", "Secteurs concernés")}
          ${statHtml("streets", "Rues distinctes")}
          ${statHtml("wastes", "Déchets relevés")}
        </div>
      </section>

      <section class="dashBlock" aria-labelledby="homeAccessTitle">
        <h3 class="visually-hidden" id="homeAccessTitle">Accès rapides</h3>
        <div class="accessGrid">
          <button type="button" class="access access--primary" data-view-target="terrain" data-new="1">
            <span class="access__icon">${icon("i-map-pin")}</span>
            <span class="access__body">
              <span class="access__title">Terrain</span>
              <span class="access__text" data-r="terrainText">Nouveau signalement</span>
            </span>
            <span class="access__cta">${icon("i-arrow-right")}</span>
          </button>
          <button type="button" class="access" data-view-target="rapport">
            <span class="access__icon">${icon("i-file")}</span>
            <span class="access__body">
              <span class="access__title">Rapports</span>
              <span class="access__text" data-r="rapportText">Aucun bon</span>
            </span>
            <span class="access__cta">${icon("i-arrow-right")}</span>
          </button>
          <button type="button" class="access" data-view-target="collecte">
            <span class="access__icon">${icon("i-calendar")}</span>
            <span class="access__body">
              <span class="access__title">Collecte</span>
              <span class="access__text">Jours de passage par adresse</span>
            </span>
            <span class="access__cta">${icon("i-arrow-right")}</span>
          </button>
        </div>
      </section>

      <div class="dashGrid">
        <section class="card dashRecent" aria-labelledby="homeRecentTitle">
          <div class="card__head">
            <h3 id="homeRecentTitle">Activité récente</h3>
            <button type="button" class="btn btn--ghost btn--sm" data-view-target="rapport" data-r="seeAll" hidden><span>Tout voir</span>${icon("i-arrow-right")}</button>
          </div>
          <div class="card__body">
            <ol class="recentList" id="homeRecent" aria-labelledby="homeRecentTitle"></ol>
            <div class="empty" data-r="empty" hidden>
              <span class="empty__icon">${icon("i-map-pin")}</span>
              <h4 class="empty__title">Aucun dépôt aujourd'hui</h4>
              <p class="empty__text">Chaque dépôt enregistré sur le terrain apparaîtra ici, avec son adresse et ses déchets.</p>
              <button type="button" class="btn btn--primary" data-view-target="terrain" data-new="1">${icon("i-plus")}<span>Nouveau signalement</span></button>
            </div>
          </div>
        </section>

        <section class="card dashSectors" aria-labelledby="homeSectorsTitle">
          <div class="card__head">
            <h3 id="homeSectorsTitle">Répartition par secteur</h3>
          </div>
          <div class="card__body">
            <div class="secBar" data-r="secBar" role="img"></div>
            <ul class="secLegend" data-r="secLegend"></ul>
          </div>
        </section>
      </div>

    </div>
  </div>`;

  refs = {};
  root.querySelectorAll("[data-r]").forEach((el) => (refs[el.dataset.r] = el));
  root.querySelectorAll("[data-stat]").forEach((el) => {
    refs["stat_" + el.dataset.stat] = { v: el.querySelector("[data-v]"), m: el.querySelector("[data-m]"), el };
  });
  refs.recent = root.querySelector("#homeRecent");
  refs.scroll = root.querySelector("#dashScroll");

  // Activité récente : délégation (la liste est reconstruite quand elle change).
  refs.recent.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const i = Number(b.dataset.i);
    if (!Number.isInteger(i) || !state.bps[i]) return;
    if (b.dataset.act === "edit") hooks.edit(i);
    else hooks.reveal(i);
  });
  // La date du rapport se règle dans les Réglages de la tournée.
  refs.alertDate.addEventListener("click", () => document.getElementById("openSettings")?.click());
}

/* ═════════════ Parties dynamiques ═════════════ */

function renderDay(n, today) {
  setText(refs.today, upperFirst(dateLongue(today)));

  // Date de tournée choisie à la main (Réglages) : signalée, jamais masquée.
  const manual = state.date && state.date !== today;
  refs.tourDate.hidden = !manual;
  if (manual) setText(refs.tourDate, `Rapport daté du ${dateFr(state.date)} (choisi dans les réglages)`);

  // Bons d'un jour antérieur (horodatage réel) : tournée précédente non clôturée.
  // Bons sans heure gardés au changement de jour : datés de la tournée précédente
  // retenue par app.js (state.staleSince), jamais d'une heure inventée.
  const stale = state.staleSince && state.staleSince < today ? state.staleSince : "";
  const old = state.bps
    .map((b) => dayOf(b.createdAt) || (stale && !b.createdAt ? stale : ""))
    .filter((d) => d && d < today)
    .sort();
  const pill = refs.tour;
  pill.classList.toggle("pill--warn", old.length > 0);
  pill.classList.toggle("pill--live", !old.length && n > 0);
  if (old.length) pill.innerHTML = `${ALERT_SVG}<span>Tournée précédente non clôturée</span>`;
  else if (n) pill.innerHTML = `<span class="pill__dot" aria-hidden="true"></span><span>En cours · ${esc(plural(n, "dépôt"))}</span>`;
  else pill.innerHTML = `<span>Aucun dépôt pour l'instant</span>`;

  refs.alert.hidden = !old.length;
  if (old.length) {
    const first = old[0];
    const last = old[old.length - 1];
    const when = first === last ? `du ${dateLongue(first)}` : `des tournées depuis le ${dateLongue(first)}`;
    const k = old.length;
    const share = k === n ? plural(k, "bon") : `${k} des ${n} bons`;
    setText(
      refs.alertText,
      `${share} ${when} ${k > 1 ? "sont toujours enregistrés" : "est toujours enregistré"}. Le rapport sera daté du ${dateFr(state.date)} : vérifiez la date, envoyez le rapport, puis clôturez la tournée.`,
    );
  }

  renderSave();
}

/** État de sauvegarde, vrai : « Enregistré · HH:MM » ou alerte si l'écriture échoue. */
let saveFailed = false;
function renderSave() {
  if (!refs.save) return;
  const pill = refs.save.closest(".pill");
  pill?.classList.toggle("pill--ok", !saveFailed);
  pill?.classList.toggle("pill--warn", saveFailed);
  pill?.querySelector("svg")?.toggleAttribute("hidden", saveFailed);
  if (saveFailed) setText(refs.save, "Sauvegarde impossible — stockage plein : exportez vos bons (Réglages)");
  else setText(refs.save, state.lastSaved ? `Enregistré sur l'appareil · ${state.lastSaved}` : "Enregistré sur l'appareil");
}
document.addEventListener("bv:saved", () => {
  saveFailed = false;
  renderSave();
});
document.addEventListener("bv:savefail", () => {
  saveFailed = true;
  renderSave();
});

function renderStats(n, counts) {
  const bps = state.bps;
  const secN = counts.filter((c) => c.n).length;
  const streets = new Set(bps.map((b) => b.rue)).size;
  const wastes = bps.reduce((s, b) => s + (b.wastes || []).length, 0);
  const kinds = new Set(bps.flatMap((b) => b.wastes || [])).size;
  const top = [...counts].sort((a, b) => b.n - a.n)[0];
  const tie = counts.filter((c) => c.n === top.n).length > 1;

  const st = refs;
  setText(st.stat_deposits.v, String(n));
  setText(st.stat_deposits.m, n > 1 ? "bons de passage" : "bon de passage");

  setText(st.stat_sectors.v, `${secN}/5`);
  st.stat_sectors.v.setAttribute("aria-label", `${secN} sur 5`);
  setText(st.stat_sectors.m, top.n && !tie ? `Le plus touché : ${SEC_NAME[top.s]}` : secN ? "Répartis à égalité" : "Aucun pour l'instant");

  setText(st.stat_streets.v, String(streets));
  setText(st.stat_streets.m, n ? `pour ${plural(n, "dépôt")}` : "Aucune pour l'instant");

  setText(st.stat_wastes.v, String(wastes));
  setText(st.stat_wastes.m, kinds ? plural(kinds, "type distinct", "types distincts") : "Aucun pour l'instant");
}

function renderAccess(n) {
  let terrain = "Nouveau signalement";
  if (state.editing != null && state.bps[state.editing]) terrain = `Modification du bon n°${state.editing + 1} en cours`;
  else if (state.current?.rue?.rue) terrain = `Saisie en cours · ${state.current.rue.rue}`;
  setText(refs.terrainText, terrain);

  let rapport = n ? `${plural(n, "bon")} · rapport prêt` : "Aucun bon";
  if (n && state.mailCustom) rapport += " · texte retouché";
  setText(refs.rapportText, rapport);
}

function renderRecent(n) {
  const start = Math.max(0, n - RECENT_MAX);
  const items = [];
  for (let i = n - 1; i >= start; i--) items.push(i);
  // Horloge : « Aujourd'hui » / « Hier » changent avec le jour.
  const sig = JSON.stringify([todayISO(), state.editing, n, items.map((i) => state.bps[i])]);
  refs.empty.hidden = n > 0;
  refs.recent.hidden = n === 0;
  refs.seeAll.hidden = n === 0;
  setText(refs.seeAll.querySelector("span"), n > RECENT_MAX ? `Tout voir (${n})` : "Tout voir");
  refs.seeAll.setAttribute("aria-label", `Tout voir : ${plural(n, "bon")} dans Rapports`);
  if (sig === recentSig) return;
  recentSig = sig;

  refs.recent.innerHTML = items
    .map((i) => {
      const bp = state.bps[i];
      const addr = adresseText(bp);
      const when = bpWhen(bp);
      const waste = wasteText(bp.wastes);
      const sec = SECTEURS.includes(bp.secteur) ? bp.secteur : null;
      const secLabel = sec ? SEC_NAME[sec] : "Sans secteur";
      const editing = state.editing === i;
      const num = i + 1;
      return `<li class="recent${editing ? " is-editing" : ""}" style="${secStyle(sec)}">
        <div class="recent__main">
          <p class="recent__addr"><span class="recent__num">n°${num}</span> <span class="recent__street">${esc(addr)}</span></p>
          <p class="recent__meta">
            <span class="secTag"><span class="secTag__dot" aria-hidden="true"></span>${esc(sec ? TITRE[sec] : secLabel)}</span>
            <span class="recent__time${when ? "" : " is-unknown"}">${esc(when || "Heure non enregistrée")}</span>
            ${editing ? `<span class="recent__badge">En cours de modification</span>` : ""}
          </p>
          <p class="recent__waste" title="${esc(waste)}"><span class="visually-hidden">Déchets : </span>${esc(waste || "—")}</p>
        </div>
        <div class="recent__actions">
          <button type="button" class="btn btn--secondary btn--sm" data-act="reveal" data-i="${i}" aria-label="Consulter le bon n°${num}, ${esc(addr)}">${icon("i-file")}<span>Consulter</span></button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="edit" data-i="${i}" aria-label="Modifier le bon n°${num}, ${esc(addr)}">${icon("i-pencil")}<span>Modifier</span></button>
        </div>
      </li>`;
    })
    .join("");
}

function renderSectors(n, counts) {
  const sig = n + "|" + counts.map((c) => c.n).join(",");
  if (sig === sectorSig) return;
  sectorSig = sig;
  const used = counts.filter((c) => c.n);
  refs.secBar.classList.toggle("is-empty", !used.length);
  refs.secBar.innerHTML = used
    .map(({ s, n: k }) => {
      const pct = Math.round((k / n) * 100);
      // Nombre écrit dans le segment quand il y a la place (couleurs ≥ 4,8:1 avec le blanc).
      return `<span class="secBar__seg" style="${secStyle(s)};flex-grow:${k}" title="${esc(TITRE[s])} : ${plural(k, "dépôt")} (${pct} %)">${k / n >= 0.12 ? k : ""}</span>`;
    })
    .join("");
  refs.secBar.setAttribute(
    "aria-label",
    used.length ? `Répartition des ${plural(n, "dépôt")} : ${used.map(({ s, n: k }) => `${SEC_NAME[s]} ${k}`).join(", ")}` : "Aucun dépôt à répartir",
  );
  refs.secLegend.innerHTML = counts
    .map(({ s, n: k }) => {
      const pct = n ? Math.round((k / n) * 100) : 0;
      return `<li class="secLegend__item${k ? "" : " is-zero"}" style="${secStyle(s)}">
        <span class="secLegend__dot" aria-hidden="true"></span>
        <span class="secLegend__name">${esc(SEC_NAME[s])}</span>
        <span class="secLegend__n">${k}</span>
        <span class="secLegend__pct">${k ? pct + " %" : "—"}</span>
      </li>`;
    })
    .join("");
}

/* ═════════════ API ═════════════ */

export function initDashboard({ edit, reveal } = {}) {
  if (typeof edit === "function") hooks.edit = edit;
  if (typeof reveal === "function") hooks.reveal = reveal;
  root = document.getElementById("viewAccueil");
  if (!root) return;
  build();
  // Entrée dans la vue : le tableau de bord repart du haut (défilement interne
  // sur ordinateur, où la page elle-même ne défile pas).
  let prev = state.view;
  onRoute((view) => {
    if (view === "accueil" && prev !== "accueil") refs.scroll?.scrollTo({ top: 0 });
    prev = view;
  });
  renderDashboard();
}

export function renderDashboard() {
  if (!root || !refs.recent) return;
  const n = state.bps.length;
  const today = todayISO();
  const counts = SECTEURS.map((s) => ({ s, n: state.bps.filter((b) => b.secteur === s).length }));
  renderDay(n, today);
  renderStats(n, counts);
  renderAccess(n);
  renderRecent(n);
  renderSectors(n, counts);
  // app.js enregistre juste après le rendu (changed() puis save()) : l'heure
  // de sauvegarde est relue une fois cet enregistrement fait.
  queueMicrotask(renderSave);
}
