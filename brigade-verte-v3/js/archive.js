// Historique des tournées — IndexedDB (base « brigade-verte », magasin « tours »).
//
// Pourquoi IndexedDB : localStorage est limité (~5 Mo) et bloquant ; l'historique
// d'une année (plusieurs milliers de signalements) doit tenir sans risque, et les
// photos (P2) y trouveront leur place. La tournée EN COURS reste dans
// localStorage (écriture synchrone à chaque geste, éprouvée) ; elle n'est vidée
// qu'APRÈS confirmation de l'écriture ici — jamais de perte à la clôture.
//
// Aucune synchronisation : ces données n'existent que sur cet appareil.

import { normalizeTour, withStatus } from "./model.js";

const DB = "brigade-verte";
const STORE = "tours";
let dbPromise = null;
let cache = null; // tournées en mémoire (l'analyse travaille dessus)
const listeners = new Set();

export const onArchiveChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn(cache || []));

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error("IndexedDB indisponible"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("date", "date");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Ouverture impossible"));
      req.onblocked = () => reject(new Error("Base bloquée par un autre onglet"));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(out?.result ?? out);
        t.onerror = () => reject(t.error || new Error("Écriture impossible"));
        t.onabort = () => reject(t.error || new Error("Écriture annulée (espace plein ?)"));
      }),
  );
}

/** Toutes les tournées archivées (du plus récent au plus ancien). */
export async function loadTours({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  const all = await tx("readonly", (s) => s.getAll());
  cache = (all || []).sort((a, b) => String(b.closedAt || b.date).localeCompare(String(a.closedAt || a.date)));
  return cache;
}

export function cachedTours() {
  return cache || [];
}

export function archiveAvailable() {
  return !!globalThis.indexedDB;
}

/** Enregistre (ou remplace) une tournée. Lève une erreur si l'écriture échoue. */
export async function putTour(tour) {
  await tx("readwrite", (s) => s.put(tour));
  const list = (cache || []).filter((t) => t.id !== tour.id);
  list.push(tour);
  cache = list.sort((a, b) => String(b.closedAt || b.date).localeCompare(String(a.closedAt || a.date)));
  emit();
  return tour;
}

/** Change le statut d'un signalement archivé (traçé dans statusLog). */
export async function setArchivedStatus(bpId, status) {
  const tours = await loadTours();
  for (const t of tours) {
    const i = t.bps.findIndex((b) => b.id === bpId);
    if (i < 0) continue;
    const bps = t.bps.slice();
    bps[i] = withStatus(bps[i], status);
    await putTour({ ...t, bps });
    return bps[i];
  }
  return null;
}

/**
 * Fusion d'un import (sauvegarde complète) : les tournées inconnues sont
 * ajoutées, les connues sont complétées signalement par signalement (le plus
 * récemment modifié l'emporte). Rien n'est supprimé.
 */
export async function mergeTours(rawTours, ctx = {}) {
  const tours = await loadTours();
  let added = 0;
  let updated = 0;
  for (const raw of rawTours || []) {
    const t = normalizeTour(raw, ctx);
    if (!t) continue;
    const existing = tours.find((x) => x.id === t.id);
    if (!existing) {
      await putTour(t);
      added++;
      continue;
    }
    const byId = new Map(existing.bps.map((b) => [b.id, b]));
    let changed = false;
    for (const b of t.bps) {
      const cur = byId.get(b.id);
      if (!cur || String(b.updatedAt) > String(cur.updatedAt)) {
        byId.set(b.id, b);
        changed = true;
      }
    }
    if (changed) {
      await putTour({ ...existing, bps: [...byId.values()] });
      updated++;
    }
  }
  return { added, updated };
}

/** Estimation de l'espace (si le navigateur la fournit). */
export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return e ? { usage: e.usage, quota: e.quota, persisted: !!persisted } : null;
  } catch (e) {
    return null;
  }
}

/** Réservé aux tests : vide le cache mémoire. */
export function _resetCache() {
  cache = null;
}
