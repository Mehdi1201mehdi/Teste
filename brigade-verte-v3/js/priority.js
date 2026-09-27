// Indice de priorité — aide INTERNE à l'organisation, pas une norme officielle.
//
// Transparent : chaque point attribué est expliqué (liste `factors`).
// Réglable : les pondérations sont modifiables dans Réglages › Indice de priorité.
// Honnête : un facteur sans donnée (écoles, zones sensibles…) n'est jamais
// deviné — il est signalé « non évalué ».

import { OPEN_STATUS } from "./model.js";

export const DEFAULT_WEIGHTS = {
  danger: 3, // déchet dangereux ou sanitaire (amiante, produits chimiques, seringues…)
  voirie: 2, // dépôt sur la chaussée : gêne ou danger pour la circulation
  volume: 1, // gros volume : encombrants, électroménager, gravats… ou ≥ 3 déchets
  recidive: 1, // par signalement antérieur au même endroit (plafonné à 3)
  anciennete: 1, // dépôt toujours ouvert : +1 au-delà de 7 jours, +2 au-delà de 30
};

export const WEIGHT_LABELS = {
  danger: "Déchet dangereux ou sanitaire",
  voirie: "Sur la chaussée",
  volume: "Gros volume",
  recidive: "Récidive (par dépôt antérieur)",
  anciennete: "Ancienneté (dépôt non traité)",
};

export const LEVELS = [
  { key: "critique", label: "Critique", min: 6 },
  { key: "haute", label: "Haute", min: 4 },
  { key: "moyenne", label: "Moyenne", min: 2 },
  { key: "faible", label: "Faible", min: 0 },
];

const DANGER_CATS = new Set(["Déchets dangereux", "Déchets sanitaires"]);
const BULKY_CATS = new Set(["Encombrants", "Électrique / électronique (DEEE)", "Électroménager", "Déchets du bâtiment", "Véhicules et épaves"]);
const DANGER_WORDS = /amiant|seringue|chimique|acide|solvant|bouteille de gaz|batterie|huile|médica/i;

export function levelOf(score) {
  return LEVELS.find((l) => score >= l.min) || LEVELS[LEVELS.length - 1];
}

export function weightsOf(custom) {
  const w = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(w)) {
    const v = Number(custom?.[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) w[k] = v;
  }
  return w;
}

/**
 * Score d'un signalement.
 * ctx : { categoryOf(label) → nom de catégorie, previous: nb de dépôts antérieurs
 *         au même endroit, now: Date, weights }
 * → { score, level, factors:[{ key, label, points, detail }], notEvaluated:[…] }
 */
export function scoreBp(bp, ctx = {}) {
  const w = weightsOf(ctx.weights);
  const cat = ctx.categoryOf || (() => "");
  const wastes = bp.wastes || [];
  const factors = [];
  const add = (key, points, detail) => points > 0 && factors.push({ key, label: WEIGHT_LABELS[key], points, detail });

  const dangerous = wastes.filter((x) => DANGER_CATS.has(cat(x)) || DANGER_WORDS.test(x));
  if (dangerous.length) add("danger", w.danger, dangerous.join(", "));

  if ((bp.precisions || []).some((p) => /chauss[ée]e/i.test(p))) add("voirie", w.voirie, "Emplacement : sur la chaussée");

  const bulky = wastes.filter((x) => BULKY_CATS.has(cat(x)));
  if (bulky.length || wastes.length >= 3) add("volume", w.volume, bulky.length ? bulky.join(", ") : `${wastes.length} déchets`);

  const prev = Math.min(3, Math.max(0, ctx.previous || 0));
  if (prev) add("recidive", w.recidive * prev, `${prev} dépôt${prev > 1 ? "s" : ""} antérieur${prev > 1 ? "s" : ""} au même endroit`);

  if (OPEN_STATUS.has(bp.status) && bp.date) {
    const [y, m, d] = bp.date.split("-").map(Number);
    const days = Math.floor(((ctx.now || new Date()) - new Date(y, m - 1, d)) / 86400000);
    if (days > 30) add("anciennete", w.anciennete * 2, `ouvert depuis ${days} jours`);
    else if (days > 7) add("anciennete", w.anciennete, `ouvert depuis ${days} jours`);
  }

  const score = factors.reduce((a, f) => a + f.points, 0);
  return {
    score,
    level: levelOf(score),
    factors,
    notEvaluated: ["Proximité d'une école ou d'une zone sensible (aucune donnée chargée)"],
  };
}
