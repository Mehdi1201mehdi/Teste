// Service d'exploitation : relie les moteurs (analyse, priorité, qualité,
// synthèse) aux données (tournée en cours + historique). Un seul endroit
// calcule la vue enrichie ; les écrans ne font qu'afficher.
//
//   COLLECTE (composer) → NORMALISATION (model) → CONTRÔLE (quality)
//   → PRIORISATION (priority) → ANALYSE (analytics) → RAPPORT (synthesis)
//   → SUIVI (statuts, historique)

import { state } from "./storage.js";
import { cachedTours } from "./archive.js";
import { flatten, recurrence, nearbyHistory } from "./analytics.js";
import { scoreBp } from "./priority.js";
import { tourQuality } from "./quality.js";
import { tourSummary } from "./synthesis.js";
import { getStreets } from "./streets.js";
import { categories, categoryItems } from "./waste.js";

let memo = null;
let memoKey = "";
let streetMap = null;
let catMap = null;

/** À appeler après toute modification (bons, statuts, archive, réglages). */
export function invalidate() {
  memo = null;
}

export function streetsByName() {
  if (!streetMap || streetMap.size !== getStreets().length) streetMap = new Map(getStreets().map((r) => [r.rue, r]));
  return streetMap;
}

export function categoryOf(label) {
  if (!catMap || !catMap.size) {
    catMap = new Map();
    categories().forEach((c) => categoryItems(c).forEach((w) => catMap.has(w) || catMap.set(w, c)));
  }
  return catMap.get(label) || "";
}

/**
 * Tous les signalements enrichis : [{ bp, tour, index?, zone, previous, priority }].
 * Calcul mémorisé jusqu'au prochain invalidate().
 */
export function enriched() {
  // Clé de fraîcheur : toute modification (bon, statut, clôture, import,
  // pondérations) change la clé — pas d'oubli d'invalidation possible.
  const tours = cachedTours();
  const key = [
    state.date,
    JSON.stringify(state.prio || null),
    state.bps.map((b) => b.id + b.updatedAt + b.status + (b.geo ? 1 : 0)).join(","),
    tours.length,
    tours.map((t) => t.id + t.bps.length + t.bps.reduce((m, b) => (String(b.updatedAt) > m ? String(b.updatedAt) : m), "")).join(","),
    new Date().toDateString(),
  ].join("|");
  if (memo && key === memoKey) return memo;
  memoKey = key;
  const now = new Date();
  const items = flatten({ tour: state.tour, date: state.date, bps: state.bps }, cachedTours());
  const rec = recurrence(items);
  items.forEach((it) => {
    const zone = rec.byId.get(it.bp.id) || null;
    it.zone = zone;
    it.previous = zone ? zone.items.filter((x) => x.bp.id !== it.bp.id && String(x.bp.date) < String(it.bp.date)).length : 0;
    it.priority = scoreBp(it.bp, { categoryOf, previous: it.previous, now, weights: state.prio });
  });
  memo = { items, zones: rec.zones, byId: new Map(items.map((x) => [x.bp.id, x])) };
  return memo;
}

/** Contrôle qualité de la tournée en cours. */
export function currentQuality() {
  return tourQuality(state.bps, { streetsByName: streetsByName() });
}

/** Synthèse de la tournée en cours (ou d'une tournée archivée). */
export function summaryOf(tour) {
  const e = enriched();
  const priorities = new Map(tour.bps.map((b) => [b.id, e.byId.get(b.id)?.priority]).filter(([, p]) => p));
  const recurrent = new Map(tour.bps.map((b) => [b.id, e.byId.get(b.id)?.zone]).filter(([, z]) => z));
  const previousTours = cachedTours().filter((t) => t.id !== tour.id && String(t.date) <= String(tour.date));
  return tourSummary(tour, {
    priorities,
    recurrent,
    previousTours,
    quality: tourQuality(tour.bps, { streetsByName: streetsByName() }),
  });
}

export function currentTourView() {
  const t = state.tour || {};
  return { id: t.id || "", date: state.date, startedAt: t.startedAt || null, closedAt: null, bps: state.bps };
}

/** Historique autour d'un lieu en cours de saisie (alerte « zone récurrente »). */
export function historyAt(place, excludeId = null) {
  const { items } = enriched();
  return nearbyHistory(items, place, { excludeId });
}

/** Complète des lignes { bp, tour } avec l'indice de priorité et la zone récurrente. */
export function withInsights(rows) {
  const { byId } = enriched();
  return rows.map((r) => {
    const e = byId.get(r.bp.id);
    return e ? { ...r, priority: e.priority, zone: e.zone } : r;
  });
}
