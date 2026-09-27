// Vue Historique — « pilotage » de l'activité, inspirée des vues liste + fiche
// d'un CRM (Twenty) et de la logique diagnostic → priorisation → suivi :
//   · Tableau de bord : indicateurs calculés UNIQUEMENT sur les données
//     présentes (jamais de chiffre inventé : une donnée absente est dite absente) ;
//   · Signalements : recherche, filtres (statut, priorité, secteur, période), tri ;
//   · Tournées : tournée en cours + tournées archivées ;
//   · fiche : indice de priorité expliqué, zone récurrente, chronologie, statut ;
//   · carte : les signalements filtrés, colorés par priorité.
// Données : tournée en cours (localStorage) + tournées archivées (IndexedDB),
// enrichies par ops.js. Tout reste sur cet appareil : aucune synchronisation.

import { $, esc, plural, dateFr, norm } from "./utils.js";
import { state } from "./storage.js";
import { STATUS, STATUS_KEYS, OPEN_STATUS } from "./model.js";
import { SECTEURS, TITRE, secStyle } from "./sectors.js";
import { loadTours, cachedTours, setArchivedStatus, onArchiveChange } from "./archive.js";
import { adresseText, mailLine } from "./bp.js";
import { toast, closeOnBackdrop } from "./ui.js";
import { copyEmailContent, buildEmailBody } from "./email.js";
import { toCSV, download } from "./exporter.js";
import { enriched, streetsByName, summaryOf } from "./ops.js";
import { LEVELS } from "./priority.js";
import { pointOf, periodCounts, weeklySeries, countBy, completeness, treatment, inPeriod, tourDuration, meanPerTour } from "./analytics.js";
import * as map from "./map.js";

const PAGE = 60;
let hooks = { edit: () => {}, changed: () => {}, settings: () => {} };
const ui = { tab: "dash", q: "", status: "", prio: "", secteur: "", period: "all", sort: "recent", limit: PAGE, dashPeriod: "all" };
let archiveError = null;

/* ─── Données ─── */

const isOpen = (bp) => OPEN_STATUS.has(bp.status);
/** Niveau affiché : priorité pour un signalement ouvert, « clos » sinon. */
const levelKey = (it) => (isOpen(it.bp) ? it.priority?.level.key || "faible" : "clos");

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
const dtFr = (iso) => (iso ? `${new Date(iso).toLocaleDateString("fr-FR")} ${hm(iso)}` : "");

/** Texte cherchable d'un signalement (référence, adresse, déchets, dates, statut, priorité…). */
function haystack(it) {
  const { bp } = it;
  return norm(
    [
      bp.ref,
      bp.rue,
      bp.numero,
      adresseText(bp),
      bp.secteur,
      (bp.wastes || []).join(" "),
      (bp.precisions || []).join(" "),
      bp.note,
      bp.date,
      dateFr(bp.date),
      STATUS[bp.status]?.label,
      isOpen(bp) ? it.priority?.level.label : "",
      it.zone ? "recurrente récidive" : "",
    ].join(" "),
  );
}

/** Filtres + recherche + tri : la liste affichée (aussi utilisée par l'export CSV et la carte). */
export function filteredItems() {
  // Date saisie (20/09, 20-09-2026) : cherchée telle quelle ; sinon chaque mot
  // doit commencer un mot de la fiche (« pneu delambre », « bv 2026 000002 »).
  const phrase = /\d[/.-]\d/.test(ui.q) ? norm(ui.q) : "";
  const words = phrase ? [] : norm(ui.q).split(/\s+/).filter(Boolean);
  const list = enriched().items.filter((it) => {
    const { bp } = it;
    if (ui.status && bp.status !== ui.status) return false;
    if (ui.secteur && bp.secteur !== ui.secteur) return false;
    if (ui.prio === "recurrent") {
      if (!it.zone) return false;
    } else if (ui.prio && (!isOpen(bp) || it.priority?.level.key !== ui.prio)) return false;
    return inPeriod(bp, ui.period);
  });
  const found = phrase
    ? list.filter((it) => haystack(it).includes(phrase))
    : words.length
      ? list.filter((it) => {
          const h = " " + haystack(it);
          return words.every((w) => h.includes(" " + w));
        })
      : list;
  const key = (it) => `${it.bp.date || ""}T${it.bp.createdAt || ""}`;
  if (ui.sort === "old") found.sort((a, b) => key(a).localeCompare(key(b)));
  else if (ui.sort === "rue") found.sort((a, b) => a.bp.rue.localeCompare(b.bp.rue, "fr") || String(a.bp.numero).localeCompare(String(b.bp.numero), "fr", { numeric: true }));
  else if (ui.sort === "prio") {
    const s = (it) => (isOpen(it.bp) ? it.priority?.score || 0 : -1);
    found.sort((a, b) => s(b) - s(a) || key(b).localeCompare(key(a)));
  } else found.sort((a, b) => key(b).localeCompare(key(a)));
  return found;
}

/* ─── Éléments ─── */

function statusChip(s) {
  return `<span class="statusChip" data-status="${esc(s)}">${esc(STATUS[s]?.label || s)}</span>`;
}

function prioChip(it, { withScore = false } = {}) {
  if (!isOpen(it.bp) || !it.priority) return "";
  const l = it.priority.level;
  return `<span class="prioChip" data-level="${l.key}" title="Indice interne de priorité : ${it.priority.score} point${it.priority.score > 1 ? "s" : ""}">${esc(l.label)}${withScore ? ` · ${it.priority.score}` : ""}</span>`;
}

function recurChip(it) {
  return it.zone ? `<span class="recurChip" title="Zone potentiellement récurrente">Récurrent · ${it.zone.count}</span>` : "";
}

function rowHtml(it, i) {
  const { bp } = it;
  const when = bp.createdAt ? `${dateFr(bp.date)} · ${hm(bp.createdAt)}` : dateFr(bp.date) || "Date non renseignée";
  return `<button type="button" class="recRow" data-i="${i}" style="${secStyle(bp.secteur)}">
    <span class="recRef mono">${esc(bp.ref || "—")}</span>
    <span class="recAddr">${esc(adresseText(bp))}</span>
    <span class="recMeta"><span class="sectorChip">${esc(bp.secteur)}</span><span class="recDate mono">${esc(when)}</span>${prioChip(it)}${recurChip(it)}</span>
    <span class="recWaste">${esc((bp.wastes || []).join(", "))}</span>
    ${statusChip(bp.status)}
  </button>`;
}

function tourRowHtml(t, i) {
  const secteurs = SECTEURS.map((s) => ({ s, n: t.bps.filter((b) => b.secteur === s).length })).filter((x) => x.n);
  const d = tourDuration(t);
  const horaires = t.startedAt && t.closedAt ? `${hm(t.startedAt)} – ${hm(t.closedAt)}${d != null ? ` · ${fmtDur(d)}` : ""}` : t.live ? "en cours" : "horaires non renseignés";
  return `<button type="button" class="recRow recRow--tour" data-t="${i}">
    <span class="recRef mono">${esc(t.live ? "Tournée en cours" : t.id)}</span>
    <span class="recAddr">Îlotage du ${esc(dateFr(t.date) || "—")}</span>
    <span class="recMeta"><span class="recDate mono">${esc(horaires)}</span>${secteurs.map((x) => `<span class="sectorChip" style="${secStyle(x.s)}">${esc(x.s)} ${x.n}</span>`).join("")}</span>
    <span class="recWaste">${plural(t.bps.length, "signalement")}</span>
    ${t.live ? statusChip("releve") : statusChip("transmis")}
  </button>`;
}

const fmtDur = (m) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`);
const pct = (n) => `${n} %`;

/* ─── Tableau de bord ─── */

function tile(label, value, sub = "", attrs = "") {
  return `<div class="kpi" ${attrs}><span class="kpiLabel">${esc(label)}</span><b class="kpiValue mono">${value}</b>${sub ? `<span class="kpiSub">${sub}</span>` : ""}</div>`;
}

/** Barres horizontales (un seul sens de lecture, valeurs écrites en clair). */
function hbars(rows, { color = () => "var(--brand)", action = "" } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return `<ol class="hbars">${rows
    .map(
      (r) => `<li>${action ? `<button type="button" class="hbarBtn" data-${action}="${esc(r.key)}">` : "<div class=\"hbarBtn\">"}
        <span class="hbarLabel">${esc(r.label || r.key)}</span>
        <span class="hbarTrack" aria-hidden="true"><i style="width:${r.n ? Math.max(2, (r.n / max) * 100) : 0}%;background:${color(r)}"></i></span>
        <span class="hbarValue mono">${r.n}</span>
      ${action ? "</button>" : "</div>"}</li>`,
    )
    .join("")}</ol>`;
}

/** Histogramme hebdomadaire : une série, une couleur, valeurs clés étiquetées. */
function weeklyChart(series) {
  const W = 600;
  const H = 150;
  const top = 18;
  const bottom = 22;
  const max = Math.max(1, ...series.map((s) => s.n));
  const bw = W / series.length;
  const imax = series.reduce((b, s, i) => (s.n > series[b].n ? i : b), 0);
  const bars = series
    .map((s, i) => {
      const h = s.n ? Math.max(3, ((H - top - bottom) * s.n) / max) : 0;
      const x = i * bw + bw * 0.18;
      const w = bw * 0.64;
      const y = H - bottom - h;
      const d = s.start.split("-");
      const lbl = `${d[2]}/${d[1]}`;
      const showVal = s.n && (i === imax || i === series.length - 1);
      return `<g><title>Semaine du ${lbl} : ${plural(s.n, "signalement")}</title>
        <rect class="wkHit" x="${i * bw}" y="0" width="${bw}" height="${H}"></rect>
        ${h ? `<path class="wkBar${i === series.length - 1 ? " is-now" : ""}" d="M${x},${H - bottom} V${y + 4} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H - bottom} Z"></path>` : ""}
        ${showVal ? `<text class="wkVal" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${s.n}</text>` : ""}
        ${i % 3 === 2 || i === series.length - 1 ? `<text class="wkAxis" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${lbl}</text>` : ""}
      </g>`;
    })
    .join("");
  const total = series.reduce((a, s) => a + s.n, 0);
  return `<svg class="wkChart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Signalements par semaine sur 12 semaines : ${total} au total, maximum ${series[imax].n}">
    <line class="wkBase" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"></line>${bars}</svg>
    <details class="dataTable"><summary>Voir les données</summary><table><thead><tr><th>Semaine du</th><th>Signalements</th></tr></thead><tbody>${series
      .map((s) => `<tr><td>${esc(dateFr(s.start))}</td><td class="mono">${s.n}</td></tr>`)
      .join("")}</tbody></table></details>`;
}

function renderDash() {
  const all = enriched();
  const items = all.items.filter(({ bp }) => inPeriod(bp, ui.dashPeriod));
  const box = $("histDash");
  if (!all.items.length) {
    box.innerHTML = `<p class="histEmpty">Aucun signalement pour l'instant. Le tableau de bord se remplit au fil des tournées relevées sur cet appareil.</p>`;
    return;
  }
  const pc = periodCounts(all.items);
  const tr = treatment(items);
  const comp = completeness(items);
  const open = items.filter((it) => isOpen(it.bp));
  const byLevel = LEVELS.map((l) => ({ key: l.key, label: l.label, n: open.filter((it) => it.priority?.level.key === l.key).length }));
  const zones = all.zones.filter((z) => z.items.some(({ bp }) => inPeriod(bp, ui.dashPeriod)));
  const tours = cachedTours().filter((t) => inPeriod({ date: t.date }, ui.dashPeriod));
  const durs = tours.map(tourDuration).filter((x) => x != null);
  const meanTour = meanPerTour(tours);
  const sectors = SECTEURS.map((s) => ({ key: s, label: TITRE[s], n: items.filter(({ bp }) => bp.secteur === s).length })).filter((x) => x.n);
  const streets = countBy(items, ({ bp }) => bp.rue, 6);
  const wastes = countBy(items, ({ bp }) => bp.wastes, 6);
  const delta = pc.delta == null ? "" : `${pc.delta > 0 ? "+" : ""}${pc.delta} % vs 30 j précédents`;

  box.innerHTML = `
    <div class="dashBar">
      <label class="visually-hidden" for="dashPeriod">Période du tableau de bord</label>
      <select id="dashPeriod" class="chipSelect">
        ${[["all", "Toute la période"], ["90", "90 derniers jours"], ["30", "30 derniers jours"], ["7", "7 derniers jours"]].map(([v, l]) => `<option value="${v}"${v === ui.dashPeriod ? " selected" : ""}>${l}</option>`).join("")}
      </select>
      <span class="dashNote">Calculé sur cet appareil · ${plural(items.length, "signalement")}</span>
    </div>

    <div class="kpis">
      ${tile("Aujourd'hui", pc.today)}
      ${tile("7 derniers jours", pc.week)}
      ${tile("30 derniers jours", pc.month, esc(delta))}
      ${tile("Priorité haute ou critique", byLevel[0].n + byLevel[1].n, "signalements ouverts", 'data-kpi="prio"')}
    </div>

    <section class="dashCard"><h3>Évolution hebdomadaire</h3>${weeklyChart(weeklySeries(all.items, 12))}</section>

    <div class="dashGrid">
      <section class="dashCard"><h3>Priorité des signalements ouverts <button type="button" class="infoBtn" data-open-prio aria-label="Comment l'indice est calculé">?</button></h3>
        ${open.length ? hbars(byLevel, { color: (r) => `var(--prio-${r.key})`, action: "prio" }) : '<p class="dashEmpty">Aucun signalement ouvert.</p>'}
        <p class="dashFoot">Indice <b>interne et réglable</b>, non officiel : aide à organiser les passages.</p>
      </section>

      <section class="dashCard"><h3>Suivi du traitement</h3>
        <dl class="dashStats">
          <div><dt>Transmis, en attente</dt><dd class="mono">${tr.waiting - tr.persistent}</dd></div>
          <div><dt>Toujours présents</dt><dd class="mono">${tr.persistent}</dd></div>
          <div><dt>Traités</dt><dd class="mono">${tr.treated}</dd></div>
          <div><dt>Délai moyen de traitement</dt><dd>${tr.meanDays != null ? `<span class="mono">${String(tr.meanDays).replace(".", ",")} j</span> <small>(${plural(tr.sample, "signalement")})</small>` : '<span class="recMissing">Non disponible : aucun signalement marqué « Traité »</span>'}</dd></div>
        </dl>
      </section>

      <section class="dashCard"><h3>Secteurs</h3>${hbars(sectors, { color: (r) => `var(--sec-${r.key.toLowerCase()})`, action: "secteur" })}</section>

      <section class="dashCard"><h3>Rues les plus concernées</h3>${streets.length ? hbars(streets, { action: "rue" }) : '<p class="dashEmpty">—</p>'}</section>

      <section class="dashCard"><h3>Déchets dominants</h3>${wastes.length ? hbars(wastes, { color: () => "var(--ink-2)" }) : '<p class="dashEmpty">—</p>'}</section>

      <section class="dashCard"><h3>Zones potentiellement récurrentes</h3>
        ${
          zones.length
            ? `<ol class="zoneList">${zones
                .slice(0, 6)
                .map(
                  (z, i) => `<li><button type="button" class="zoneBtn" data-zone="${i}">
                <b>${esc(z.numero ? `${z.numero} ${z.rue}` : z.rue)}</b>
                <span>${plural(z.count, "dépôt")} · ${plural(z.dates.length, "date")} · du ${esc(dateFr(z.first))} au ${esc(dateFr(z.last))}</span></button></li>`,
                )
                .join("")}</ol>`
            : '<p class="dashEmpty">Aucune pour l\'instant : une zone apparaît quand des dépôts sont relevés au même endroit (même adresse ou moins de 35 m) à des dates différentes.</p>'
        }
      </section>

      <section class="dashCard"><h3>Qualité des données</h3>
        ${
          comp
            ? `<dl class="dashStats">
          <div><dt>Avec numéro</dt><dd class="mono">${pct(comp.numero)}</dd></div>
          <div><dt>Avec position mesurée</dt><dd class="mono">${pct(comp.geo)}</dd></div>
          <div><dt>Avec emplacement précis</dt><dd class="mono">${pct(comp.place)}</dd></div>
          <div><dt>Horodatés</dt><dd class="mono">${pct(comp.time)}</dd></div>
        </dl>`
            : ""
        }
      </section>

      <section class="dashCard"><h3>Tournées</h3>
        <dl class="dashStats">
          <div><dt>Tournées clôturées</dt><dd class="mono">${tours.length}</dd></div>
          <div><dt>Signalements par tournée</dt><dd>${meanTour != null ? `<span class="mono">${String(meanTour).replace(".", ",")}</span>` : '<span class="recMissing">Aucune tournée clôturée</span>'}</dd></div>
          <div><dt>Durée moyenne</dt><dd>${durs.length ? `<span class="mono">${fmtDur(Math.round(durs.reduce((a, b) => a + b, 0) / durs.length))}</span>` : '<span class="recMissing">Non disponible</span>'}</dd></div>
        </dl>
      </section>
    </div>`;

  $("dashPeriod").onchange = (e) => {
    ui.dashPeriod = e.target.value;
    renderHistory();
  };
  const toList = (patch) => {
    Object.assign(ui, { q: "", status: "", prio: "", secteur: "", period: ui.dashPeriod, sort: "recent", limit: PAGE }, patch);
    ui.tab = "bps";
    syncControls();
    renderHistory();
  };
  box.querySelectorAll("[data-prio]").forEach((b) => (b.onclick = () => toList({ prio: b.dataset.prio, sort: "prio" })));
  box.querySelectorAll("[data-secteur]").forEach((b) => (b.onclick = () => toList({ secteur: b.dataset.secteur })));
  box.querySelectorAll("[data-rue]").forEach((b) => (b.onclick = () => toList({ q: b.dataset.rue })));
  box.querySelector('[data-kpi="prio"]')?.addEventListener("click", () => toList({ prio: "", sort: "prio", status: "" }));
  box.querySelectorAll("[data-zone]").forEach((b) => {
    b.onclick = () => {
      const z = zones[+b.dataset.zone];
      openRecord(z.items[z.items.length - 1]);
    };
  });
  box.querySelector("[data-open-prio]")?.addEventListener("click", () => hooks.settings("prio"));
}

/* ─── Carte ─── */

let mapTimer = 0;
let mapItems = [];
let fitPending = false; // cadrage des signalements à l'entrée dans la vue
function syncMap(items) {
  clearTimeout(mapTimer);
  mapTimer = setTimeout(() => {
    if ($("viewHistorique").hidden) return;
    const sbn = streetsByName();
    // La tournée en cours a déjà ses balises numérotées : on ne la double pas.
    mapItems = items.filter((it) => !it.tour?.live).map((it) => ({ it, p: pointOf(it.bp, sbn) })).filter((x) => x.p);
    map.setHistory(
      mapItems.map(({ it, p }) => ({ lat: p.lat, lon: p.lon, approx: p.approx, level: levelKey(it), label: `${it.bp.ref} · ${adresseText(it.bp)}${p.approx ? " (position approchée)" : ""}` })),
      (i) => openRecord(mapItems[i].it),
    );
    if (fitPending && mapItems.length) {
      fitPending = false;
      map.fitPoints(mapItems.map(({ p }) => [p.lat, p.lon]));
    }
  }, 120);
}

/* ─── Rendu ─── */

let shown = [];
let shownTours = [];

function syncControls() {
  $("histSearch").value = ui.q;
  $("histStatus").value = ui.status;
  $("histPrio").value = ui.prio;
  $("histSecteur").value = ui.secteur;
  $("histPeriod").value = ui.period;
  $("histSort").value = ui.sort;
}

export function renderHistory() {
  const view = $("viewHistorique");
  if (!view || view.hidden) return;
  const tours = cachedTours();
  const nb = state.bps.length + tours.reduce((a, t) => a + t.bps.length, 0);
  $("histCount").textContent = `${plural(nb, "signalement")} · ${plural(tours.length + (state.bps.length ? 1 : 0), "tournée")} · données de cet appareil, non synchronisées`;
  $("histArchiveWarn").hidden = !archiveError;
  $("histArchiveWarn").textContent = archiveError ? `Historique illisible sur ce navigateur (${archiveError}). La tournée en cours reste disponible.` : "";
  document.querySelectorAll("#histTabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === ui.tab)));
  $("histTitle").textContent = ui.tab === "dash" ? "Tableau de bord" : ui.tab === "tours" ? "Tournées" : "Signalements";
  $("histFilters").hidden = ui.tab !== "bps";
  $("histDash").hidden = ui.tab !== "dash";
  $("histList").hidden = ui.tab === "dash";
  const list = $("histList");

  if (ui.tab === "dash") {
    renderDash();
    $("histMore").hidden = true;
    syncMap(enriched().items.filter(({ bp }) => inPeriod(bp, ui.dashPeriod)));
  } else if (ui.tab === "tours") {
    shownTours = [...(state.bps.length ? [{ id: state.tour?.id || "", date: state.date, startedAt: state.tour?.startedAt, bps: state.bps, live: true }] : []), ...tours];
    list.innerHTML = shownTours.length ? shownTours.map(tourRowHtml).join("") : `<p class="histEmpty">Aucune tournée pour l'instant. Une tournée apparaît ici dès son premier bon, puis reste consultable après sa clôture.</p>`;
    $("histMore").hidden = true;
    $("histResult").textContent = "";
    syncMap(enriched().items);
  } else {
    const items = filteredItems();
    shown = items.slice(0, ui.limit);
    list.innerHTML = shown.length ? shown.map(rowHtml).join("") : `<p class="histEmpty">${nb ? "Aucun signalement ne correspond à ces critères." : "Aucun signalement pour l'instant."}</p>`;
    $("histMore").hidden = items.length <= ui.limit;
    $("histMore").textContent = `Afficher plus (${items.length - shown.length} restants)`;
    $("histResult").textContent = nb ? `${plural(items.length, "résultat")}` : "";
    syncMap(items);
  }
}

/* ─── Fiche ─── */

function field(label, value, cls = "") {
  return `<div class="recField ${cls}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}
const missing = '<span class="recMissing">Information non renseignée</span>';

function priorityHtml(it) {
  if (!it.priority) return "";
  if (!isOpen(it.bp)) return `<section class="recTimeline"><h3>Indice de priorité</h3><p class="recMissing">Sans objet : signalement traité.</p></section>`;
  const p = it.priority;
  return `<section class="recTimeline recPrio" aria-labelledby="recPrioTitle">
    <h3 id="recPrioTitle">Indice de priorité ${prioChip(it, { withScore: true })}</h3>
    ${
      p.factors.length
        ? `<ul class="prioFactors">${p.factors.map((f) => `<li><span class="mono">+${f.points}</span><span><b>${esc(f.label)}</b> — ${esc(f.detail)}</span></li>`).join("")}</ul>`
        : '<p class="recMissing">Aucun facteur aggravant relevé.</p>'
    }
    <p class="prioNote">Non évalué : ${esc(p.notEvaluated.join(" ; "))}. Indice interne, non officiel — <button type="button" class="linkBtn linkBtn--inline" data-open-prio>régler les pondérations</button>.</p>
  </section>`;
}

function zoneHtml(it) {
  if (!it.zone) return "";
  const others = it.zone.items.filter((x) => x.bp.id !== it.bp.id);
  return `<section class="recTimeline recZone" aria-labelledby="recZoneTitle">
    <h3 id="recZoneTitle">Zone potentiellement récurrente</h3>
    <p class="prioNote">${plural(it.zone.count, "dépôt")} au même endroit (même adresse ou moins de 35 m) sur ${plural(it.zone.dates.length, "date")}, du ${esc(dateFr(it.zone.first))} au ${esc(dateFr(it.zone.last))}.</p>
    <div class="recList">${others.map((x, k) => `<button type="button" class="recMini" data-z="${k}"><span class="mono">${esc(x.bp.ref || "—")}</span> ${esc(dateFr(x.bp.date))} · ${esc((x.bp.wastes || []).slice(0, 2).join(", "))} ${statusChip(x.bp.status)}</button>`).join("")}</div>
  </section>`;
}

function openRecord(itIn) {
  // Toujours la version enrichie la plus récente (statut changé, pondérations…).
  const it = enriched().byId.get(itIn.bp.id) || itIn;
  const { bp, tour } = it;
  const dlg = $("recordDlg");
  const pt = pointOf(bp, streetsByName());
  const pos = bp.geo
    ? `${bp.geo.lat.toFixed(5)}, ${bp.geo.lon.toFixed(5)}${bp.geo.acc != null ? ` · ± ${bp.geo.acc} m` : ""} · ${bp.geo.source === "carte" ? "point touché sur la carte" : "mesure GPS"}`
    : '<span class="recMissing">Non mesurée (localisation à la rue)</span>';
  const timeline = [
    ...(bp.createdAt ? [{ at: bp.createdAt, text: "Signalement relevé" }] : []),
    ...(bp.statusLog || []).filter((e) => e.at && !(e.status === "releve" && e.at === bp.createdAt)).map((e) => ({ at: e.at, text: `Statut : ${STATUS[e.status]?.label || e.status}` })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const canChange = !tour?.live;
  $("recordBody").innerHTML = `
    <header class="recHead" style="${secStyle(bp.secteur)}">
      <p class="recHeadRef mono">${esc(bp.ref || "—")}</p>
      <h2 id="recordTitle">${esc(adresseText(bp))}</h2>
      <p class="recHeadMeta"><span class="sectorChip">${esc(bp.secteur)}</span>${statusChip(bp.status)}${prioChip(it)}${recurChip(it)}</p>
    </header>
    ${
      canChange
        ? `<div class="recActions" role="group" aria-label="Changer le statut">${["traite", "persistant", "transmis"]
            .map((s) => `<button type="button" class="chipBtn" data-status="${s}" aria-pressed="${bp.status === s}">${esc(STATUS[s].label)}</button>`)
            .join("")}${pt ? '<button type="button" class="chipBtn" id="recMap">Voir sur la carte</button>' : ""}</div>`
        : `<div class="recActions"><button type="button" class="chipBtn" id="recEdit">Modifier ce bon</button><span class="recHint">Tournée en cours : le statut évoluera à la clôture.</span></div>`
    }
    <dl class="recFields">
      ${field("Date", esc(dateFr(bp.date) || "") || missing)}
      ${field("Heure", bp.createdAt ? esc(hm(bp.createdAt)) : missing)}
      ${field("Tournée", tour?.live ? "En cours" : esc(tour?.id || bp.tourId || "") || missing)}
      ${field("Numéro", esc(bp.numero) || '<span class="recMissing">Sans numéro</span>')}
      ${field("Emplacement", esc((bp.precisions || []).join(", ")) || missing)}
      ${field("Déchets", esc((bp.wastes || []).join(", ")) || missing, "recField--wide")}
      ${field("Position", pos, "recField--wide")}
      ${field("Note interne", esc(bp.note) || '<span class="recMissing">Aucune</span>', "recField--wide")}
      ${field("Ligne du rapport", `<span class="mono">${esc(mailLine(bp))}</span>`, "recField--wide")}
      ${field("Dernière modification", esc(dtFr(bp.updatedAt)) || missing)}
    </dl>
    ${priorityHtml(it)}
    ${zoneHtml(it)}
    <section class="recTimeline" aria-labelledby="recTlTitle">
      <h3 id="recTlTitle">Chronologie</h3>
      ${timeline.length ? `<ol>${timeline.map((e) => `<li><time class="mono">${esc(dtFr(e.at))}</time><span>${esc(e.text)}</span></li>`).join("")}</ol>` : '<p class="recMissing">Aucun événement daté (bon antérieur à l\'horodatage).</p>'}
    </section>`;
  $("recordBody").querySelectorAll(".recActions [data-status]").forEach((b) => {
    b.onclick = async () => {
      try {
        const updated = await setArchivedStatus(bp.id, b.dataset.status);
        if (!updated) return toast("Signalement introuvable dans l'historique.", null, "error");
        toast(`${bp.ref} : ${STATUS[updated.status].label}.`, null, "ok");
        openRecord({ bp: updated, tour: cachedTours().find((t) => t.bps.some((x) => x.id === bp.id)) || tour });
        renderHistory();
        hooks.changed({});
      } catch (e) {
        toast(`Changement impossible (${e.message}).`, null, "error");
      }
    };
  });
  $("recEdit")?.addEventListener("click", () => {
    dlg.close();
    hooks.edit(it.index);
  });
  $("recMap")?.addEventListener("click", () => {
    dlg.close();
    showMap(true);
    map.focusPoint(pt.lat, pt.lon);
  });
  $("recordBody").querySelectorAll("[data-open-prio]").forEach((b) => (b.onclick = () => {
    dlg.close();
    hooks.settings("prio");
  }));
  const others = it.zone ? it.zone.items.filter((x) => x.bp.id !== bp.id) : [];
  $("recordBody").querySelectorAll("[data-z]").forEach((b) => (b.onclick = () => openRecord(others[+b.dataset.z])));
  if (!dlg.open) dlg.showModal();
}

function openTour(t) {
  const dlg = $("recordDlg");
  const body = t.mailText || "";
  const d = tourDuration(t);
  const sum = summaryOf(t);
  $("recordBody").innerHTML = `
    <header class="recHead">
      <p class="recHeadRef mono">${esc(t.live ? "Tournée en cours" : t.id)}</p>
      <h2 id="recordTitle">Îlotage du ${esc(dateFr(t.date) || "—")}</h2>
      <p class="recHeadMeta">${statusChip(t.live ? "releve" : "transmis")}<span class="mono">${esc(t.startedAt ? `${hm(t.startedAt)} – ${t.closedAt ? hm(t.closedAt) : "…"}` : "Horaires non renseignés")}</span></p>
    </header>
    <dl class="recFields">
      ${field("Signalements", String(t.bps.length))}
      ${field("Durée", d != null ? esc(fmtDur(d)) : missing)}
      ${field("Clôturée le", t.closedAt ? esc(dtFr(t.closedAt)) : "Non clôturée")}
      ${field("Destinataire", esc(t.mailTo) || missing)}
    </dl>
    <section class="recTimeline"><h3>Synthèse</h3><ul class="synthList">${sum.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>
    ${
      body
        ? `<section class="recTimeline"><h3>Message envoyé</h3><pre class="recMail mono">${buildEmailBody(body).previewHtml}</pre>
           <button type="button" class="chipBtn" id="recCopyMail">Copier ce message</button></section>`
        : ""
    }
    <section class="recTimeline"><h3>Signalements de la tournée</h3>
      <div class="recList">${t.bps.map((bp, i) => `<button type="button" class="recMini" data-k="${i}"><span class="mono">${esc(bp.ref || "—")}</span> ${esc(adresseText(bp))} ${statusChip(bp.status)}</button>`).join("")}</div>
    </section>`;
  $("recCopyMail")?.addEventListener("click", async () => {
    const b = buildEmailBody(body);
    const res = await copyEmailContent({ html: b.html, text: b.plain });
    toast(res ? "Message copié." : "Copie impossible sur ce navigateur.", null, res ? "ok" : "error");
  });
  $("recordBody").querySelectorAll(".recMini").forEach((b) => {
    b.onclick = () => {
      const bp = t.bps[+b.dataset.k];
      openRecord({ bp, tour: t, index: t.live ? state.bps.indexOf(bp) : undefined });
    };
  });
  if (!dlg.open) dlg.showModal();
}

/** Mobile : la carte remplace un moment la liste (bouton « Carte » / « Liste »). */
function showMap(on) {
  const app = document.querySelector(".app");
  app.toggleAttribute("data-histmap", !!on);
  $("histMapBtn").setAttribute("aria-pressed", String(!!on));
  $("histMapBtn").querySelector("span").textContent = on ? "Liste" : "Carte";
}

/** À la sortie de la vue : couche et bascule carte retirées. */
export function leaveHistory() {
  clearTimeout(mapTimer);
  map.clearHistory();
  showMap(false);
}

/* ─── Liaisons ─── */

/** Relit l'historique (un autre onglet a pu clôturer une tournée entre-temps). */
export async function refreshArchive({ fresh = false, entering = false } = {}) {
  if (entering) fitPending = true;
  try {
    await loadTours({ fresh });
    archiveError = null;
  } catch (e) {
    archiveError = e.message;
  }
  renderHistory();
}

export function initHistory(opts = {}) {
  hooks = { ...hooks, ...opts };
  closeOnBackdrop($("recordDlg"));
  $("histSearch").addEventListener("input", (e) => {
    ui.q = e.target.value;
    ui.limit = PAGE;
    renderHistory();
  });
  [
    ["histStatus", "status"],
    ["histPrio", "prio"],
    ["histSecteur", "secteur"],
    ["histPeriod", "period"],
    ["histSort", "sort"],
  ].forEach(([id, k]) => {
    $(id).addEventListener("change", (e) => {
      ui[k] = e.target.value;
      ui.limit = PAGE;
      renderHistory();
    });
  });
  $("histStatus").innerHTML = `<option value="">Tous les statuts</option>${STATUS_KEYS.map((s) => `<option value="${s}">${STATUS[s].label}</option>`).join("")}`;
  $("histPrio").innerHTML = `<option value="">Toutes priorités</option>${LEVELS.map((l) => `<option value="${l.key}">Priorité ${l.label.toLowerCase()}</option>`).join("")}<option value="recurrent">Zones récurrentes</option>`;
  $("histSecteur").innerHTML = `<option value="">Tous les secteurs</option>${SECTEURS.map((s) => `<option value="${s}">${s}</option>`).join("")}`;
  document.querySelectorAll("#histTabs [data-tab]").forEach((b) => {
    b.onclick = () => {
      ui.tab = b.dataset.tab;
      renderHistory();
    };
  });
  $("histCsv").onclick = () => {
    const rows = filteredItems();
    if (!rows.length) return toast("Aucun signalement dans cette liste.");
    download(`brigade-verte-selection-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows), "text/csv;charset=utf-8");
    toast(`${plural(rows.length, "signalement")} exporté${rows.length > 1 ? "s" : ""} en CSV.`, null, "ok");
  };
  $("histMapBtn").onclick = () => {
    const on = !document.querySelector(".app").hasAttribute("data-histmap");
    showMap(on);
    if (on) map.fitPoints(mapItems.map(({ p }) => [p.lat, p.lon]));
  };
  $("histMore").onclick = () => {
    ui.limit += PAGE;
    renderHistory();
  };
  $("histList").addEventListener("click", (e) => {
    const row = e.target.closest(".recRow");
    if (!row) return;
    if (row.dataset.t != null) openTour(shownTours[+row.dataset.t]);
    else openRecord(shown[+row.dataset.i]);
  });
  onArchiveChange(() => renderHistory());
  refreshArchive();
}
