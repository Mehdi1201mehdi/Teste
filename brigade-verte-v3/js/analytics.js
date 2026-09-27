// Analyse — transforme les signalements bruts en indicateurs (fonctions pures).
//
// Principe : un indicateur n'est calculé que si ses données existent. Chaque
// fonction renvoie `null` (ou une liste vide) plutôt qu'un zéro trompeur
// quand l'information manque (ex. délai de traitement sans aucun « Traité »).

import { OPEN_STATUS, statusDate } from "./model.js";
import { normName } from "./streetgeo.js";

const DAY = 86400000;

/* ─── Mise à plat ─── */

/**
 * Tous les signalements (tournée en cours + historique), chacun avec sa
 * tournée. `current` : { tour, date, bps } ; `tours` : tournées archivées.
 */
export function flatten(current, tours = []) {
  const out = [];
  const cur = current?.bps || [];
  if (cur.length) {
    const t = { id: current.tour?.id || "", date: current.date, startedAt: current.tour?.startedAt || null, closedAt: null, live: true };
    cur.forEach((bp, index) => out.push({ bp, tour: t, index }));
  }
  tours.forEach((t) => (t.bps || []).forEach((bp) => out.push({ bp, tour: t })));
  return out;
}

/* ─── Géographie ─── */

export function distM(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  const y = (lat2 - lat1) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/**
 * Position d'un signalement : mesure GPS / carte si elle existe, sinon point
 * de référence de la rue (marqué `approx`, jamais utilisé pour la récidive).
 */
export function pointOf(bp, streetsByName) {
  if (bp.geo) return { lat: bp.geo.lat, lon: bp.geo.lon, approx: false };
  const r = streetsByName?.get(bp.rue);
  return r ? { lat: r.lat, lon: r.lon, approx: true } : null;
}

/* ─── Récidive ─── */

/**
 * Zones récurrentes : signalements liés s'ils sont à moins de `radius` mètres
 * (positions mesurées uniquement) OU à la même adresse exacte (rue + numéro).
 * Une zone est « récurrente » si elle compte ≥ 2 signalements à ≥ 2 dates.
 * Renvoie { zones:[{ items, dates, first, last, rue, numero }], byId: Map(id → zone) }.
 */
export function recurrence(items, { radius = 35 } = {}) {
  const n = items.length;
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  // Même adresse exacte
  const byAddr = new Map();
  items.forEach(({ bp }, i) => {
    if (!bp.numero) return;
    const k = normName(bp.rue) + "|" + bp.numero.toLowerCase().replace(/\s+/g, "");
    if (byAddr.has(k)) union(i, byAddr.get(k));
    else byAddr.set(k, i);
  });
  // Proximité : grille ~ 50 m pour éviter la comparaison de toutes les paires
  const cell = 0.0005;
  const grid = new Map();
  items.forEach(({ bp }, i) => {
    if (!bp.geo) return;
    const gx = Math.floor(bp.geo.lon / cell);
    const gy = Math.floor(bp.geo.lat / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx}:${gy + dy}`) || []) {
          const o = items[j].bp.geo;
          if (distM(bp.geo.lat, bp.geo.lon, o.lat, o.lon) <= radius) union(i, j);
        }
      }
    }
    const k = `${gx}:${gy}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(items[i]);
  }
  const zones = [];
  const byId = new Map();
  for (const g of groups.values()) {
    const dates = [...new Set(g.map((x) => x.bp.date).filter(Boolean))].sort();
    if (g.length < 2 || dates.length < 2) continue;
    const sorted = g.slice().sort((a, b) => String(a.bp.date).localeCompare(String(b.bp.date)));
    const last = sorted[sorted.length - 1].bp;
    const zone = { items: sorted, dates, first: dates[0], last: dates[dates.length - 1], rue: last.rue, numero: last.numero, count: g.length };
    zones.push(zone);
    g.forEach((x) => byId.set(x.bp.id, zone));
  }
  zones.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
  return { zones, byId };
}

/**
 * Historique connu autour d'un lieu en cours de saisie (avant enregistrement) :
 * signalements à moins de `radius` m, ou à la même adresse. Pour l'alerte terrain.
 */
export function nearbyHistory(items, { geo, rue, numero }, { radius = 35, excludeId = null } = {}) {
  const key = numero ? normName(rue) + "|" + String(numero).toLowerCase().replace(/\s+/g, "") : "";
  return items
    .filter(({ bp }) => bp.id !== excludeId)
    .filter(({ bp }) => {
      if (key && bp.numero && normName(bp.rue) + "|" + bp.numero.toLowerCase().replace(/\s+/g, "") === key) return true;
      return geo && bp.geo && distM(geo.lat, geo.lon, bp.geo.lat, bp.geo.lon) <= radius;
    })
    .sort((a, b) => String(b.bp.date).localeCompare(String(a.bp.date)));
}

/* ─── Périodes ─── */

export function dayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
const isoDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Jour (Date locale, minuit) d'un signalement, d'après sa date de tournée. */
export function bpDay(bp) {
  if (bp.date) {
    const [y, m, d] = bp.date.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return bp.createdAt ? dayStart(bp.createdAt) : null;
}

/** Comptes : aujourd'hui, 7 j, 30 j, 30 j précédents (pour l'évolution). */
export function periodCounts(items, now = new Date()) {
  const today = dayStart(now).getTime();
  let t = 0;
  let w = 0;
  let m = 0;
  let pm = 0;
  for (const { bp } of items) {
    const d = bpDay(bp)?.getTime();
    if (d == null) continue;
    const age = Math.round((today - d) / DAY);
    if (age === 0) t++;
    if (age >= 0 && age < 7) w++;
    if (age >= 0 && age < 30) m++;
    else if (age >= 30 && age < 60) pm++;
  }
  return { today: t, week: w, month: m, prevMonth: pm, delta: pm ? Math.round(((m - pm) / pm) * 100) : null };
}

/** Série hebdomadaire (lundi → dimanche) sur `weeks` semaines, la plus récente en dernier. */
export function weeklySeries(items, weeks = 12, now = new Date()) {
  const monday = dayStart(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const starts = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const s = new Date(monday);
    s.setDate(s.getDate() - 7 * i);
    starts.push(s);
  }
  const counts = starts.map(() => 0);
  for (const { bp } of items) {
    const d = bpDay(bp);
    if (!d) continue;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (d >= starts[i]) {
        const end = new Date(starts[i]);
        end.setDate(end.getDate() + 7);
        if (d < end) counts[i]++;
        break;
      }
    }
  }
  return starts.map((s, i) => ({ start: isoDay(s), n: counts[i] }));
}

/** Filtre période : "7" | "30" | "90" | "all". */
export function inPeriod(bp, period, now = new Date()) {
  if (period === "all") return true;
  const d = bpDay(bp);
  if (!d) return false;
  const age = (dayStart(now) - d) / DAY;
  return age >= 0 && age < Number(period);
}

/* ─── Répartitions ─── */

export function countBy(items, keyFn, limit = 0) {
  const m = new Map();
  for (const it of items) {
    for (const k of [].concat(keyFn(it) || [])) {
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  const list = [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key), "fr"));
  return limit ? list.slice(0, limit) : list;
}

/* ─── Qualité & traitement ─── */

/** Part des signalements dont chaque information est renseignée. */
export function completeness(items) {
  const n = items.length;
  if (!n) return null;
  const has = (f) => Math.round((items.filter(({ bp }) => f(bp)).length / n) * 100);
  const numero = has((b) => !!b.numero || (b.precisions || []).some((p) => /n°\s*\d/.test(p)));
  const geo = has((b) => !!b.geo);
  const place = has((b) => (b.precisions || []).length > 0);
  const time = has((b) => !!b.createdAt);
  return { n, numero, geo, place, time, score: Math.round((numero + geo + place) / 3) };
}

/** Statuts et délai moyen de traitement (jours) — null si aucun traitement daté. */
export function treatment(items) {
  const open = items.filter(({ bp }) => OPEN_STATUS.has(bp.status) && bp.status !== "releve").length;
  const done = items.filter(({ bp }) => bp.status === "traite");
  const delays = done
    .map(({ bp }) => {
      const t = statusDate(bp, "traite");
      const start = bp.createdAt || (bp.date ? bp.date + "T12:00:00" : null);
      return t && start ? (Date.parse(t) - Date.parse(start)) / DAY : null;
    })
    .filter((x) => x != null && x >= 0);
  return {
    waiting: open,
    treated: done.length,
    persistent: items.filter(({ bp }) => bp.status === "persistant").length,
    meanDays: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null,
    sample: delays.length,
  };
}

/** Durée d'une tournée (minutes) si début et fin sont connus. */
export function tourDuration(t) {
  if (!t?.startedAt || !t?.closedAt) return null;
  const m = Math.round((Date.parse(t.closedAt) - Date.parse(t.startedAt)) / 60000);
  return m >= 0 ? m : null;
}

/** Moyenne de signalements par tournée clôturée (null si aucune). */
export function meanPerTour(tours) {
  if (!tours.length) return null;
  return Math.round((tours.reduce((a, t) => a + (t.bps?.length || 0), 0) / tours.length) * 10) / 10;
}
