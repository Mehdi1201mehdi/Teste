// Bons de Passage (BP) — règles métier pures, sans DOM.
// Le format des lignes du message est STRICTEMENT celui de l'outil historique :
// les destinataires (services de propreté) le connaissent et le traitent tel quel.

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
 * Ligne du message : précisions AVANT l'adresse, puis les déchets.
 * Ex : « Au pied du PAV 76 Rue du Professeur Christian Cabrol : Tapis, Table. »
 * Si une précision contient déjà le numéro (« Devant le n°4 »), il n'est pas
 * répété dans l'adresse : « Devant le n°4 Rue de Castille : Palette. »
 */
export function mailLine(bp) {
  const precs = bp.precisions || [];
  const numeroInPrecision = bp.numero && precs.some((p) => p.includes("n°" + bp.numero));
  const adresse = (bp.numero && !numeroInPrecision ? bp.numero + " " : "") + bp.rue;
  const prefix = precs.length ? precs.join(", ") + " " : "";
  return `${prefix}${adresse} : ${(bp.wastes || []).join(", ")}.`;
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
