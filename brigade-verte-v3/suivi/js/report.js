// Compte rendu professionnel : statistiques, tableaux regroupés par secteur
// et par rue, mise en évidence des anomalies, et exports (PDF/impression,
// Excel, CSV, copie, partage). Aucune dépendance externe.

import { state, numCounts, streetHasPb, streetIsDone, streetTouched } from "./state.js";
import { SECTEURS, SECTOR_META, numKey, allStreets } from "./data.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function sectorOfStreet(name) {
  const s = allStreets().find((r) => r.rue === name);
  return s ? s.secteur : "CENTRE";
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Modèle de données du compte rendu (source unique pour affichage et exports). */
export function buildModel() {
  const bySector = {};
  SECTEURS.forEach((s) => (bySector[s] = []));
  let rues = 0, ruesDone = 0, numsSeen = 0, numsPb = 0;
  const notes = [];

  for (const [name, d] of Object.entries(state.streets)) {
    if (!streetTouched(d)) continue;
    const sec = sectorOfStreet(name);
    const c = numCounts(d);
    rues++;
    if (streetIsDone(d)) ruesDone++;
    numsSeen += c.seen;
    numsPb += c.pb;
    const anomalies = d.nums
      .filter((x) => x.k === "pb")
      .map((x) => ({ n: x.n, objs: x.objs.slice(), note: (x.note || "").trim() }))
      .sort((a, b) => numKey(a.n) - numKey(b.n) || a.n.localeCompare(b.n, "fr"));
    if (d.note && d.note.trim()) notes.push({ rue: name, sec, note: d.note.trim() });
    (bySector[sec] = bySector[sec] || []).push({ rue: name, counts: c, anomalies });
  }
  SECTEURS.forEach((s) =>
    bySector[s].sort((a, b) => a.rue.localeCompare(b.rue, "fr")));

  const started = state.startedAt ? new Date(state.startedAt).getTime() : 0;
  const last = state.lastAt ? new Date(state.lastAt).getTime() : 0;
  return {
    bySector,
    notes,
    stats: { rues, ruesDone, numsSeen, numsPb, duration: fmtDuration(last - started) },
    startedAt: state.startedAt,
    lastAt: state.lastAt,
  };
}

function dateLong() {
  return new Date().toLocaleDateString("fr-FR",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function hm(iso) {
  return iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

/** Rendu HTML riche du compte rendu dans un conteneur. */
export function renderReport(el) {
  const m = buildModel();
  const s = m.stats;
  let h = "";
  h += `<div class="doc-head">
    <h2>Compte rendu de tournée préventive</h2>
    <p class="doc-sub">Match France / Maroc (22 h 00) — dispositif classé à risque</p>
    <p class="doc-meta">${esc(dateLong())}${state.agent ? " · " + esc(state.agent) : ""}</p>
  </div>`;

  h += `<div class="kpis">
    <div class="kpi"><b>${s.rues}</b><span>rues contrôlées</span></div>
    <div class="kpi"><b>${s.numsSeen}</b><span>numéros contrôlés</span></div>
    <div class="kpi kpi-pb"><b>${s.numsPb}</b><span>anomalies</span></div>
    <div class="kpi"><b>${esc(s.duration)}</b><span>temps de tournée</span></div>
  </div>`;
  h += `<p class="doc-meta">Début ${hm(m.startedAt)} · dernier contrôle ${hm(m.lastAt)}</p>`;

  if (s.numsPb === 0) {
    h += `<p class="doc-none">✓ Aucune anomalie constatée — rien à faire enlever sur la voie publique.</p>`;
  } else {
    h += `<div class="tbl-wrap"><table class="rep">
      <thead><tr><th>N°</th><th>Objet à enlever</th><th>Précision</th></tr></thead><tbody>`;
    for (const sec of SECTEURS) {
      const streets = m.bySector[sec].filter((x) => x.anomalies.length);
      if (!streets.length) continue;
      h += `<tr class="grp-sec" style="--sc:${SECTOR_META[sec].color}">
        <td colspan="3">${SECTOR_META[sec].emoji} Secteur ${esc(SECTOR_META[sec].label)}</td></tr>`;
      for (const st of streets) {
        h += `<tr class="grp-rue"><td colspan="3">${esc(st.rue)} · ${st.anomalies.length} anomalie${st.anomalies.length > 1 ? "s" : ""}</td></tr>`;
        for (const a of st.anomalies) {
          h += `<tr><td class="n">${esc(a.n)}</td>
            <td class="obj">${esc(a.objs.join(", ") || "À enlever")}</td>
            <td>${esc(a.note || "—")}</td></tr>`;
        }
      }
    }
    h += `</tbody></table></div>`;
  }

  if (m.notes.length) {
    h += `<h3 class="doc-h3">Observations générales</h3>
      <div class="tbl-wrap"><table class="rep">
      <thead><tr><th>Rue</th><th>Observation</th></tr></thead><tbody>`;
    m.notes.sort((a, b) => a.rue.localeCompare(b.rue, "fr"));
    for (const o of m.notes) {
      h += `<tr><td class="n" style="white-space:normal">${esc(o.rue)}</td><td>${esc(o.note)}</td></tr>`;
    }
    h += `</tbody></table></div>`;
  }

  h += `<p class="doc-close">Compte rendu transmis au CSU et à l'ensemble des chefs de service,
    afin que les bacs et tout objet ou projectile susceptible de rester sur la voie publique
    soient pris en charge dans les meilleurs délais.</p>`;
  el.innerHTML = h;
}

// ── Exports ──────────────────────────────────────────────────────────
function rowsForExport() {
  const m = buildModel();
  const rows = [];
  for (const sec of SECTEURS) {
    for (const st of m.bySector[sec]) {
      for (const a of st.anomalies) {
        rows.push([SECTOR_META[sec].label, st.rue, a.n, a.objs.join(", ") || "À enlever", a.note]);
      }
    }
  }
  return { m, rows };
}

export function reportText() {
  const m = buildModel();
  const s = m.stats;
  const L = [];
  L.push("COMPTE RENDU — TOURNÉE PRÉVENTIVE");
  L.push("Match France / Maroc (22h00) — classé à risque");
  L.push(dateLong() + (state.agent ? " · " + state.agent : ""));
  L.push("");
  L.push(`Rues contrôlées : ${s.rues} | Numéros : ${s.numsSeen} | Anomalies : ${s.numsPb} | Durée : ${s.duration}`);
  L.push("");
  if (s.numsPb === 0) {
    L.push("Aucune anomalie constatée — rien à enlever sur la voie publique.");
  } else {
    L.push("ANOMALIES À PRENDRE EN CHARGE :");
    for (const sec of SECTEURS) {
      const streets = m.bySector[sec].filter((x) => x.anomalies.length);
      if (!streets.length) continue;
      L.push("");
      L.push("— Secteur " + SECTOR_META[sec].label + " —");
      for (const st of streets) {
        L.push("• " + st.rue + " :");
        for (const a of st.anomalies) {
          let line = "    n° " + a.n + " — " + (a.objs.join(", ") || "à enlever");
          if (a.note) line += " (" + a.note + ")";
          L.push(line);
        }
      }
    }
  }
  if (m.notes.length) {
    L.push("");
    L.push("OBSERVATIONS :");
    m.notes.forEach((o) => L.push("• " + o.rue + " : " + o.note));
  }
  L.push("");
  L.push("Transmis au CSU et aux chefs de service pour prise en charge des bacs et objets restant sur la voie publique.");
  return L.join("\n");
}

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export function exportCSV() {
  const { rows } = rowsForExport();
  const head = ["Secteur", "Rue", "N°", "Objet", "Précision"];
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [head, ...rows].map((r) => r.map(q).join(";"));
  download(`compte-rendu-tournee-${stamp()}.csv`, "text/csv;charset=utf-8", "﻿" + lines.join("\r\n"));
}

export function exportXLS() {
  // Classeur Excel via table HTML (mime ms-excel) — s'ouvre dans Excel/LibreOffice.
  const { m, rows } = rowsForExport();
  const s = m.stats;
  const esc2 = esc;
  let t = `<table border="1"><tr><th colspan="5">Compte rendu tournée — ${esc2(dateLong())}</th></tr>`;
  t += `<tr><td colspan="5">Rues : ${s.rues} · Numéros : ${s.numsSeen} · Anomalies : ${s.numsPb} · Durée : ${esc2(s.duration)}</td></tr>`;
  t += `<tr><th>Secteur</th><th>Rue</th><th>N°</th><th>Objet</th><th>Précision</th></tr>`;
  rows.forEach((r) => {
    t += "<tr>" + r.map((c) => `<td>${esc2(c)}</td>`).join("") + "</tr>";
  });
  t += "</table>";
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${t}</body></html>`;
  download(`compte-rendu-tournee-${stamp()}.xls`, "application/vnd.ms-excel", html);
}

export function printReport() {
  window.print();
}
