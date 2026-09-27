// Vue Historique — inspirée des vues « liste + fiche » d'un CRM (Twenty) :
//   · deux listes : Signalements et Tournées ;
//   · recherche, filtres (statut, secteur, période) et tri ;
//   · fiche détaillée avec chronologie des statuts et changement de statut.
// Données : tournée en cours (localStorage) + tournées archivées (IndexedDB).
// Tout reste sur cet appareil : aucune synchronisation n'est simulée.

import { $, esc, plural, dateFr, norm } from "./utils.js";
import { state } from "./storage.js";
import { STATUS, STATUS_KEYS } from "./model.js";
import { SECTEURS, secStyle } from "./sectors.js";
import { loadTours, cachedTours, setArchivedStatus, onArchiveChange } from "./archive.js";
import { adresseText, mailLine } from "./bp.js";
import { toast, closeOnBackdrop } from "./ui.js";
import { copyEmailContent, buildEmailBody } from "./email.js";
import { toCSV, download } from "./exporter.js";

const PAGE = 60;
let hooks = { edit: () => {}, changed: () => {} };
const ui = { tab: "bps", q: "", status: "", secteur: "", period: "all", sort: "recent", limit: PAGE };
let archiveError = null;

/* ─── Données ─── */

/** Tous les signalements : tournée en cours d'abord, puis l'historique. */
function allItems() {
  const out = state.bps.map((bp, index) => ({ bp, index, tour: { id: state.tour?.id || "", date: state.date, live: true } }));
  cachedTours().forEach((t) => t.bps.forEach((bp) => out.push({ bp, tour: t })));
  return out;
}

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
const dtFr = (iso) => (iso ? `${new Date(iso).toLocaleDateString("fr-FR")} ${hm(iso)}` : "");

function periodOk(bp) {
  if (ui.period === "all") return true;
  if (!bp.date) return false;
  const [y, m, d] = bp.date.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const age = (today - new Date(y, m - 1, d)) / 86400000;
  return age >= 0 && age < Number(ui.period);
}

/** Texte cherchable d'un signalement (référence, adresse, déchets, dates, statut…). */
function haystack({ bp }) {
  return norm(
    [bp.ref, bp.rue, bp.numero, adresseText(bp), bp.secteur, (bp.wastes || []).join(" "), (bp.precisions || []).join(" "), bp.note, bp.date, dateFr(bp.date), STATUS[bp.status]?.label].join(" "),
  );
}

/** Filtres + recherche + tri : la liste affichée (aussi utilisée par l'export CSV). */
export function filteredItems() {
  // Date saisie (20/09, 20-09-2026) : cherchée telle quelle ; sinon chaque mot
  // doit commencer un mot de la fiche (« pneu delambre », « bv 2026 000002 »).
  const phrase = /\d[/.-]\d/.test(ui.q) ? norm(ui.q) : "";
  const words = phrase ? [] : norm(ui.q).split(/\s+/).filter(Boolean);
  const list = allItems().filter(({ bp }) => {
    if (ui.status && bp.status !== ui.status) return false;
    if (ui.secteur && bp.secteur !== ui.secteur) return false;
    return periodOk(bp);
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
  else found.sort((a, b) => key(b).localeCompare(key(a)));
  return found;
}

/* ─── Rendu ─── */

function statusChip(s) {
  return `<span class="statusChip" data-status="${esc(s)}">${esc(STATUS[s]?.label || s)}</span>`;
}

function rowHtml(it, i) {
  const { bp } = it;
  const when = bp.createdAt ? `${dateFr(bp.date)} · ${hm(bp.createdAt)}` : dateFr(bp.date) || "Date non renseignée";
  return `<button type="button" class="recRow" data-i="${i}" style="${secStyle(bp.secteur)}">
    <span class="recRef mono">${esc(bp.ref || "—")}</span>
    <span class="recAddr">${esc(adresseText(bp))}</span>
    <span class="recMeta"><span class="sectorChip">${esc(bp.secteur)}</span><span class="recDate mono">${esc(when)}</span></span>
    <span class="recWaste">${esc((bp.wastes || []).join(", "))}</span>
    ${statusChip(bp.status)}
  </button>`;
}

function tourRowHtml(t, i) {
  const secteurs = SECTEURS.map((s) => ({ s, n: t.bps.filter((b) => b.secteur === s).length })).filter((x) => x.n);
  const horaires = t.startedAt && t.closedAt ? `${hm(t.startedAt)} – ${hm(t.closedAt)}` : t.live ? "en cours" : "horaires non renseignés";
  return `<button type="button" class="recRow recRow--tour" data-t="${i}">
    <span class="recRef mono">${esc(t.live ? "Tournée en cours" : t.id)}</span>
    <span class="recAddr">Îlotage du ${esc(dateFr(t.date) || "—")}</span>
    <span class="recMeta"><span class="recDate mono">${esc(horaires)}</span>${secteurs.map((x) => `<span class="sectorChip" style="${secStyle(x.s)}">${esc(x.s)} ${x.n}</span>`).join("")}</span>
    <span class="recWaste">${plural(t.bps.length, "signalement")}</span>
    ${t.live ? statusChip("releve") : statusChip("transmis")}
  </button>`;
}

let shown = [];
let shownTours = [];

export function renderHistory() {
  const view = $("viewHistorique");
  if (!view || view.hidden) return;
  const tours = cachedTours();
  const nb = state.bps.length + tours.reduce((a, t) => a + t.bps.length, 0);
  $("histCount").textContent = `${plural(nb, "signalement")} · ${plural(tours.length + (state.bps.length ? 1 : 0), "tournée")} · données de cet appareil, non synchronisées`;
  $("histArchiveWarn").hidden = !archiveError;
  $("histArchiveWarn").textContent = archiveError ? `Historique illisible sur ce navigateur (${archiveError}). La tournée en cours reste disponible.` : "";
  document.querySelectorAll("#histTabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === ui.tab)));
  $("histFilters").hidden = ui.tab !== "bps";
  const list = $("histList");

  if (ui.tab === "tours") {
    shownTours = [...(state.bps.length ? [{ id: state.tour?.id || "", date: state.date, startedAt: state.tour?.startedAt, bps: state.bps, live: true }] : []), ...tours];
    list.innerHTML = shownTours.length ? shownTours.map(tourRowHtml).join("") : `<p class="histEmpty">Aucune tournée pour l'instant. Une tournée apparaît ici dès son premier bon, puis reste consultable après sa clôture.</p>`;
    $("histMore").hidden = true;
    $("histResult").textContent = "";
  } else {
    const items = filteredItems();
    shown = items.slice(0, ui.limit);
    list.innerHTML = shown.length ? shown.map(rowHtml).join("") : `<p class="histEmpty">${nb ? "Aucun signalement ne correspond à ces critères." : "Aucun signalement pour l'instant."}</p>`;
    $("histMore").hidden = items.length <= ui.limit;
    $("histMore").textContent = `Afficher plus (${items.length - shown.length} restants)`;
    $("histResult").textContent = nb ? `${plural(items.length, "résultat")}` : "";
  }
}

/* ─── Fiche ─── */

function field(label, value, cls = "") {
  return `<div class="recField ${cls}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}
const missing = '<span class="recMissing">Information non renseignée</span>';

function openRecord(it) {
  const { bp, tour } = it;
  const dlg = $("recordDlg");
  const pos = bp.geo
    ? `${bp.geo.lat.toFixed(5)}, ${bp.geo.lon.toFixed(5)}${bp.geo.acc != null ? ` · ± ${bp.geo.acc} m` : ""} · ${bp.geo.source === "carte" ? "point touché sur la carte" : "mesure GPS"}`
    : '<span class="recMissing">Non mesurée (localisation à la rue)</span>';
  const timeline = [
    ...(bp.createdAt ? [{ at: bp.createdAt, text: "Signalement relevé" }] : []),
    ...(bp.statusLog || []).filter((e) => e.at && !(e.status === "releve" && e.at === bp.createdAt)).map((e) => ({ at: e.at, text: `Statut : ${STATUS[e.status]?.label || e.status}` })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const canChange = !tour.live;
  $("recordBody").innerHTML = `
    <header class="recHead" style="${secStyle(bp.secteur)}">
      <p class="recHeadRef mono">${esc(bp.ref || "—")}</p>
      <h2 id="recordTitle">${esc(adresseText(bp))}</h2>
      <p class="recHeadMeta"><span class="sectorChip">${esc(bp.secteur)}</span>${statusChip(bp.status)}</p>
    </header>
    ${
      canChange
        ? `<div class="recActions" role="group" aria-label="Changer le statut">${["traite", "persistant", "transmis"]
            .map((s) => `<button type="button" class="chipBtn" data-status="${s}" aria-pressed="${bp.status === s}">${esc(STATUS[s].label)}</button>`)
            .join("")}</div>`
        : `<div class="recActions"><button type="button" class="chipBtn" id="recEdit">Modifier ce bon</button><span class="recHint">Tournée en cours : le statut évoluera à la clôture.</span></div>`
    }
    <dl class="recFields">
      ${field("Date", esc(dateFr(bp.date) || "") || missing)}
      ${field("Heure", bp.createdAt ? esc(hm(bp.createdAt)) : missing)}
      ${field("Tournée", tour.live ? "En cours" : esc(tour.id))}
      ${field("Numéro", esc(bp.numero) || '<span class="recMissing">Sans numéro</span>')}
      ${field("Emplacement", esc((bp.precisions || []).join(", ")) || missing)}
      ${field("Déchets", esc((bp.wastes || []).join(", ")) || missing, "recField--wide")}
      ${field("Position", pos, "recField--wide")}
      ${field("Note interne", esc(bp.note) || '<span class="recMissing">Aucune</span>', "recField--wide")}
      ${field("Ligne du rapport", `<span class="mono">${esc(mailLine(bp))}</span>`, "recField--wide")}
      ${field("Dernière modification", esc(dtFr(bp.updatedAt)) || missing)}
    </dl>
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
  if (!dlg.open) dlg.showModal();
}

function openTour(t) {
  const dlg = $("recordDlg");
  const body = t.mailText || "";
  $("recordBody").innerHTML = `
    <header class="recHead">
      <p class="recHeadRef mono">${esc(t.live ? "Tournée en cours" : t.id)}</p>
      <h2 id="recordTitle">Îlotage du ${esc(dateFr(t.date) || "—")}</h2>
      <p class="recHeadMeta">${statusChip(t.live ? "releve" : "transmis")}<span class="mono">${esc(t.startedAt ? `${hm(t.startedAt)} – ${t.closedAt ? hm(t.closedAt) : "…"}` : "Horaires non renseignés")}</span></p>
    </header>
    <dl class="recFields">
      ${field("Signalements", String(t.bps.length))}
      ${field("Clôturée le", t.closedAt ? esc(dtFr(t.closedAt)) : "Non clôturée")}
      ${field("Destinataire", esc(t.mailTo) || missing, "recField--wide")}
    </dl>
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

/* ─── Liaisons ─── */

/** Relit l'historique (un autre onglet a pu clôturer une tournée entre-temps). */
export async function refreshArchive({ fresh = false } = {}) {
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
