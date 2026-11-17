// Sauvegarde de secours : export JSON et relecture de tous les formats connus.
//   v3 / v4 : { app, version, date, bps:[…] }  ou un simple tableau de bons
//   v5      : { app, schema:5, current:{ date, bps }, tours:[…] }
// Les tournées archivées par la v5 (base IndexedDB « brigade-verte ») ne sont
// plus affichées, mais restent sur l'appareil : elles sont jointes à l'export
// pour ne jamais être perdues. Rien n'est jamais envoyé hors de l'appareil.

import { SECTEURS } from "./sectors.js";

/** Tournées archivées par la v5, si la base existe ([] sinon, sans la créer). */
export async function readArchivedTours() {
  try {
    if (!globalThis.indexedDB) return [];
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === "brigade-verte")) return [];
    }
    return await new Promise((resolve) => {
      const req = indexedDB.open("brigade-verte");
      // Base absente : on annule la création pour ne rien laisser derrière soi.
      req.onupgradeneeded = () => req.transaction.abort();
      req.onerror = () => resolve([]);
      req.onblocked = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("tours")) {
          db.close();
          return resolve([]);
        }
        const all = db.transaction("tours", "readonly").objectStore("tours").getAll();
        all.onsuccess = () => {
          db.close();
          resolve(Array.isArray(all.result) ? all.result : []);
        };
        all.onerror = () => {
          db.close();
          resolve([]);
        };
      };
    });
  } catch (e) {
    return [];
  }
}

/** Contenu du fichier exporté (lisible par cette version et par les précédentes). */
export function buildExport(state, tours = []) {
  const data = { app: "brigade-verte-amiens", version: 4, exportedAt: new Date().toISOString(), date: state.date, bps: state.bps };
  if (tours.length) data.tours = tours;
  return data;
}

const str = (v, max = 300) => (v == null ? "" : String(v).slice(0, max));
const strList = (v) =>
  Array.isArray(v) ? v.filter((x) => (typeof x === "string" && x.trim()) || typeof x === "number").map((x) => str(x).trim()).slice(0, 60) : [];

/**
 * Normalise un bon importé. Le secteur est remis en majuscules et doit être
 * l'un des 5 secteurs : sinon le bon serait compté mais absent du message.
 * Les champs supplémentaires (identifiant, note… des versions v5) sont gardés.
 */
export function cleanBp(b) {
  if (!b || typeof b !== "object" || typeof b.rue !== "string" || !b.rue.trim()) return null;
  const secteur = str(b.secteur).trim().toUpperCase();
  if (!SECTEURS.includes(secteur)) return null;
  // Numéro : texte ou nombre seulement (jamais « [object Object] »).
  if (b.numero != null && !["string", "number"].includes(typeof b.numero)) return null;
  const wastes = strList(b.wastes);
  if (!wastes.length) return null; // sans déchet, la ligne du message serait vide
  const out = { ...b };
  // Horodatages : gardés seulement s'ils sont des dates valides (jamais inventés).
  for (const k of ["createdAt", "updatedAt"]) {
    if (k in out && (typeof out[k] !== "string" || Number.isNaN(Date.parse(out[k])))) delete out[k];
  }
  return {
    ...out,
    rue: b.rue.trim().slice(0, 300),
    numero: str(b.numero, 20).trim(),
    secteur,
    wastes,
    precisions: strList(b.precisions),
  };
}

/**
 * Lit un fichier de sauvegarde, quel que soit son âge.
 * → { bps, rejected, date } ; lève une erreur lisible si le format est inconnu.
 */
export function parseBackup(json) {
  let raw = null;
  let date = null;
  if (Array.isArray(json)) raw = json;
  else if (json && typeof json === "object") {
    if (Array.isArray(json.bps)) {
      raw = json.bps;
      date = json.date || null;
    } else if (json.current && Array.isArray(json.current.bps)) {
      raw = json.current.bps;
      date = json.current.date || null;
    }
  }
  if (!raw) throw new Error("format");
  const bps = raw.map(cleanBp).filter(Boolean);
  return { bps, rejected: raw.length - bps.length, date: /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : null };
}
