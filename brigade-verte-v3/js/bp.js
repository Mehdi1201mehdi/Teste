// Bons de Passage (BP) — règles métier pures, sans DOM.
// Les lignes du message sont rédigées en français correct par phrase.js
// (même ordre qu'avant : lieu précis, adresse, « : », déchets).

import { ligne } from "./phrase.js";

// Les 7 précisions autorisées ; le libellé exact est conservé pour le message.
export const PREC = {
  angle: "À l'angle de",
  face: "En face du n°",
  devant: "Devant le n°",
  entre: "Entre deux maisons",
  trottoir: "Sur le trottoir",
  chaussee: "Sur la chaussée",
  pav: "Au pied du PAV",
};

/** Libellés des précisions de la saisie en cours (numéro inséré si connu). */
export function precisionLabels(c) {
  const num = (c.numero || "").trim();
  const labels = (c.precisions || []).map((k) => {
    if (k === "face") return num ? "En face du n°" + num : "En face du n°";
    if (k === "devant") return num ? "Devant le n°" + num : "Devant le n°";
    return PREC[k] || k;
  });
  const custom = (c.precisionCustom || "").trim();
  if (custom) labels.push(custom);
  return labels;
}

export function adresseText(bp) {
  return (bp.numero ? bp.numero + " " : "") + bp.rue;
}

/**
 * Ligne du message, en français : lieu précis + adresse, puis les déchets.
 * Ex : « Au pied du PAV, à hauteur du n° 76 de la rue du Professeur Christian Cabrol : tapis et table. »
 *      « Devant le n° 4 de la rue de Castille : palette. »
 * Fonctionne aussi avec les bons enregistrés par les versions précédentes
 * (les précisions y sont stockées sous forme de libellés).
 */
export function mailLine(bp) {
  const { keys, custom } = splitPrecisions(bp);
  // Numéro : celui du bon, sinon celui écrit dans « Devant le n°4 » (anciens bons).
  let num = (bp.numero || "").trim();
  if (!num) {
    const m = (bp.precisions || []).join(" ").match(/n°\s*([0-9]+\s*(?:bis|ter|quater|[a-z])?)/i);
    if (m) num = m[1];
  }
  return ligne({ rue: bp.rue, numero: num, keys, custom }, bp.wastes || []);
}

/** Construit un BP à partir de la saisie en cours (null si incomplète). */
export function buildBp(c) {
  if (!c.rue || !c.secteur || !c.wastes.length) return null;
  return {
    rue: c.rue.rue,
    numero: (c.numero || "").trim(),
    secteur: c.secteur,
    wastes: [...c.wastes],
    precisions: precisionLabels(c),
  };
}

/**
 * Inverse de precisionLabels : retrouve les bascules et le texte libre
 * d'un BP enregistré, pour que « Modifier » rouvre la saisie à l'identique.
 */
export function splitPrecisions(bp) {
  const keys = [];
  const free = [];
  (bp.precisions || []).forEach((label) => {
    if (/^En face du n°/.test(label)) keys.push("face");
    else if (/^Devant le n°/.test(label)) keys.push("devant");
    else {
      const k = Object.keys(PREC).find((key) => PREC[key] === label);
      if (k) keys.push(k);
      else free.push(label);
    }
  });
  return { keys, custom: free.join(", ") };
}

export const addressOk = (c) => !!c.rue && !!c.secteur;
export const wastesOk = (c) => c.wastes.length > 0;

/**
 * Doublon probable dans la tournée : même rue ET même numéro (ou tous deux
 * sans numéro). Renvoie { index, sameWaste } du premier bon concerné, sinon
 * null. `except` : index du bon en cours de modification (ignoré).
 */
export function findDuplicate(bps, bp, except = null) {
  if (!bp || !bp.rue) return null;
  const rue = bp.rue.trim().toLowerCase();
  const num = (bp.numero || "").trim().toLowerCase();
  const index = bps.findIndex(
    (b, i) => i !== except && (b.rue || "").trim().toLowerCase() === rue && (b.numero || "").trim().toLowerCase() === num,
  );
  if (index < 0) return null;
  const sameWaste = (bp.wastes || []).some((w) => (bps[index].wastes || []).includes(w));
  return { index, sameWaste };
}
