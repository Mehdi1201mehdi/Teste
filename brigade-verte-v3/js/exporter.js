// Exports — un format par usage, tous cohérents :
//   · CSV       tableur (Excel / LibreOffice) : une ligne par signalement
//   · JSON      sauvegarde complète (tournée en cours + historique), restaurable
//   · Impression rapport imprimable (voir pilotage.js / CSS @media print)
//   · Outlook   message historique (email.js)
// Fonctions pures, sauf download().

import { SCHEMA, STATUS } from "./model.js";
import { mailLine } from "./bp.js";

const CSV_COLS = [
  ["reference", (x) => x.bp.ref],
  ["date", (x) => x.bp.date],
  ["heure", (x) => (x.bp.createdAt ? new Date(x.bp.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "")],
  ["tournee", (x) => x.tour?.id || x.bp.tourId],
  ["secteur", (x) => x.bp.secteur],
  ["rue", (x) => x.bp.rue],
  ["numero", (x) => x.bp.numero],
  ["emplacement", (x) => (x.bp.precisions || []).join(" | ")],
  ["dechets", (x) => (x.bp.wastes || []).join(" | ")],
  ["nb_dechets", (x) => (x.bp.wastes || []).length],
  ["latitude", (x) => x.bp.geo?.lat ?? ""],
  ["longitude", (x) => x.bp.geo?.lon ?? ""],
  ["precision_gps_m", (x) => x.bp.geo?.acc ?? ""],
  ["source_position", (x) => x.bp.geo?.source || "rue"],
  ["statut", (x) => STATUS[x.bp.status]?.label || x.bp.status],
  ["note_interne", (x) => x.bp.note],
  ["ligne_message", (x) => mailLine(x.bp)],
  ["id", (x) => x.bp.id],
  ["modifie_le", (x) => x.bp.updatedAt],
];

function cell(v) {
  const s = v == null ? "" : String(v);
  // Neutralise l'injection de formules dans les tableurs (=, +, -, @).
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV « à la française » : séparateur « ; », BOM UTF-8 (accents corrects dans
 * Excel), fins de ligne CRLF. `rows` : [{ bp, tour }].
 */
export function toCSV(rows) {
  const head = CSV_COLS.map(([k]) => k).join(";");
  const body = rows.map((r) => CSV_COLS.map(([, f]) => cell(f(r))).join(";"));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}

/** Sauvegarde complète, restaurable par fusion. */
export function buildBackup(state, tours) {
  return {
    app: "brigade-verte-amiens",
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    current: { date: state.date, tour: state.tour, bps: state.bps },
    tours,
    settings: { mailTo: state.mailTo || "", prio: state.prio || null },
    // Éléments illisibles mis de côté à la migration : copiés tels quels.
    quarantine: Array.isArray(state.quarantine) ? state.quarantine : [],
  };
}

/**
 * Lecture d'un fichier importé, quel que soit son âge :
 *   v5  { schema:5, current:{ bps }, tours:[…] }
 *   v3/v4  { version, date, bps:[…] }  ou  tableau de bons
 * → { currentBps, date, tours, settings } ou lève une erreur lisible.
 */
export function parseBackup(json) {
  if (Array.isArray(json)) return { currentBps: json, date: null, tours: [], settings: null };
  if (!json || typeof json !== "object") throw new Error("Fichier non reconnu : choisissez un export .json de Brigade Verte.");
  if (json.schema >= 5 || json.tours) {
    return {
      currentBps: Array.isArray(json.current?.bps) ? json.current.bps : [],
      date: json.current?.date || null,
      tours: Array.isArray(json.tours) ? json.tours : [],
      settings: json.settings || null,
    };
  }
  if (Array.isArray(json.bps)) return { currentBps: json.bps, date: json.date || null, tours: [], settings: null };
  throw new Error("Fichier non reconnu : choisissez un export .json de Brigade Verte.");
}

/** Téléchargement d'un fichier généré. */
export function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
