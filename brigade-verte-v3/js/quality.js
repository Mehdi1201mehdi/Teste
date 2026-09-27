// Contrôle qualité — détecte les signalements incomplets ou incohérents
// AVANT l'envoi du rapport (fonctions pures). Ne corrige rien tout seul :
// il signale, l'agent décide.

import { normName } from "./streetgeo.js";

export const SEVERITY = { error: "À corriger", warn: "À vérifier", info: "Information" };

/**
 * Points à vérifier sur un signalement.
 * ctx : { streetsByName: Map, duplicates: Set(id), sectorOfStreet(rue) }
 * → [{ code, severity, text }]
 */
export function checkBp(bp, ctx = {}) {
  const out = [];
  const add = (code, severity, text) => out.push({ code, severity, text });
  const street = ctx.streetsByName?.get(bp.rue);
  if (!street) add("rue-inconnue", "error", "Rue absente du référentiel des rues d'Amiens");
  if (!(bp.wastes || []).length) add("sans-dechet", "error", "Aucun déchet renseigné");
  if (street && street.secteur && bp.secteur && street.secteur !== bp.secteur) {
    add("secteur-different", "warn", `Secteur ${bp.secteur} différent du secteur habituel de la rue (${street.secteur}) — vérifiez`);
  }
  if (ctx.duplicates?.has(bp.id)) add("doublon", "warn", "Même adresse qu'un autre bon de la tournée — doublon ?");
  const numInPrec = (bp.precisions || []).some((p) => /n°\s*\d/.test(p));
  if (!bp.numero && !numInPrec) add("sans-numero", "info", "Sans numéro de rue");
  if (!(bp.precisions || []).length) add("sans-emplacement", "info", "Emplacement précis non renseigné");
  if (!bp.geo) add("sans-position", "info", "Position non mesurée (localisation à la rue)");
  if (bp.geo && bp.geo.acc != null && bp.geo.acc > 50) add("gps-imprecis", "info", `Position GPS imprécise (± ${bp.geo.acc} m)`);
  return out;
}

/** Doublons de la tournée : même rue + même numéro (ou tous deux sans numéro). */
export function duplicateIds(bps) {
  const seen = new Map();
  const dup = new Set();
  bps.forEach((b) => {
    const k = normName(b.rue) + "|" + (b.numero || "").trim().toLowerCase();
    if (seen.has(k)) {
      dup.add(b.id);
      dup.add(seen.get(k));
    } else seen.set(k, b.id);
  });
  return dup;
}

/**
 * Bilan de la tournée : score de complétude (0–100) et points à vérifier.
 * Les « info » ne bloquent rien ; elles alimentent le score.
 */
export function tourQuality(bps, ctx = {}) {
  const duplicates = duplicateIds(bps);
  const rows = bps.map((bp, index) => ({ bp, index, issues: checkBp(bp, { ...ctx, duplicates }) }));
  const expected = bps.length * 3; // numéro, emplacement, position
  const missing = rows.reduce((a, r) => a + r.issues.filter((i) => ["sans-numero", "sans-emplacement", "sans-position"].includes(i.code)).length, 0);
  return {
    score: bps.length ? Math.round(((expected - missing) / expected) * 100) : null,
    errors: rows.filter((r) => r.issues.some((i) => i.severity === "error")),
    warnings: rows.filter((r) => r.issues.some((i) => i.severity === "warn")),
    rows,
  };
}
