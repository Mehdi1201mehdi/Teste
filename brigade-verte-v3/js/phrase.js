// Rédaction en français des lignes du rapport — fonctions pures, sans DOM.
//
// Une ligne = lieu précis + adresse, puis « : », puis les déchets.
//   « Devant le n° 4 de la rue de Castille : palette. »
//   « Au pied du PAV, à hauteur du n° 76 de la rue du Professeur Christian Cabrol : tapis et table. »
//   « Sur le trottoir de l'allée des Tilleuls : matelas, canapé et sac OM. »
//   « 8, rue Jules Barni : pneu. »
// Règles : article contracté selon le type de voie (de la rue, de l'allée,
// du boulevard…), type de voie en minuscule dans la phrase (typographie
// française), numéro écrit « n° 8 » / « 12 bis », déchets en minuscules
// (sigles conservés : OM, DEEE, PAV), dernier déchet relié par « et ».

/* ─── Voies ─── */

// Type de voie → article contracté (« de la », « de l' », « du »).
const VOIE = {
  rue: "de la", ruelle: "de la", ruellette: "de la", venelle: "de la", voie: "de la",
  place: "de la", placette: "de la", cour: "de la", cité: "de la", résidence: "de la",
  route: "de la", chaussée: "de la", promenade: "de la", passerelle: "de la", villa: "de la",
  allée: "de l'", avenue: "de l'", impasse: "de l'", esplanade: "de l'", enclos: "de l'", espace: "de l'",
  boulevard: "du", chemin: "du", square: "du", passage: "du", quai: "du", carrefour: "du",
  "rond-point": "du", mail: "du", clos: "du", lotissement: "du", parvis: "du", port: "du",
  hameau: "du", parc: "du", pont: "du", sentier: "du", ballodrome: "du", jardin: "du",
};
// Adjectifs placés avant le type : « Petite rue Saint-Leu », « Grande rue… ».
const ADJ = ["petite", "petit", "grande", "grand", "vieille", "vieux", "nouvelle", "ancienne", "ancien"];

/*
 * Orthographe des noms de voie dans le rapport (les données officielles et la
 * recherche de rue ne sont pas modifiées) :
 *  · ordinaux : « 3éme », « 51ème » → « 3e », « 51e » ;
 *  · ligature : « Oeillets », « Soeur » → « Œillets », « Sœur » ;
 *  · guillemets français : "Sœur Emmanuelle" → « Sœur Emmanuelle » ;
 *  · majuscules accentuées (règle de l'Académie) : « Edouard » → « Édouard ».
 *    Liste fermée, vérifiée mot par mot : les noms qui s'écrivent sans accent
 *    (Edmond, Elbeuf, Eugène, Europe…) ne sont pas touchés.
 */
const ACCENTS = {
  Echange: "Échange", Echauguette: "Échauguette", Ecluse: "Écluse", Ecoles: "Écoles", Ecole: "École",
  Ecoute: "Écoute", Ecuyer: "Écuyer", Edimbourg: "Édimbourg", Edith: "Édith", Edouard: "Édouard",
  Eglise: "Église", Eloi: "Éloi", Eluard: "Éluard", Emile: "Émile", Epis: "Épis", Epousée: "Épousée",
  Epée: "Épée", Etamines: "Étamines", Etang: "Étang", Etoile: "Étoile", Etouvie: "Étouvie", Eté: "Été",
  Eventail: "Éventail", Evêque: "Évêque", Evrard: "Évrard", Etienne: "Étienne", Etats: "États",
};
export function orthographe(nom) {
  return String(nom || "")
    .replace(/\b(\d+)\s?(?:ème|éme|ieme|ième)\b/g, "$1e")
    .replace(/\bOe(?=il|uvre)/g, "Œ")
    .replace(/oe(?=u|il)/g, "œ")
    .replace(/\bE[a-zéèêë]+/g, (w) => ACCENTS[w] || w)
    .replace(/"([^"]+)"/g, "« $1 »")
    .replace(/n° /g, "n°\u00a0");
}

const lowerFirst = (s) => s.charAt(0).toLocaleLowerCase("fr") + s.slice(1);
export const upperFirst = (s) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);

/**
 * Nom de voie prêt pour la phrase.
 * → { bare: "rue Jules Barni", of: "de la rue Jules Barni" }
 */
export function voie(nom) {
  // Découpe sur les espaces ordinaires seulement : les insécables (n° 25) restent.
  let words = orthographe(nom).trim().split(/[ \t]+/).filter(Boolean);
  // « Le jardin d'Anna » : l'article est porté par la préposition (« du jardin »).
  if (words.length > 1 && /^(le|la|les)$/i.test(words[0]) && VOIE[words[1].toLowerCase()]) words = words.slice(1);
  if (!words.length) return { bare: "", of: "" };
  let i = 0;
  if (words.length > 2 && ADJ.includes(words[0].toLowerCase()) && VOIE[words[1].toLowerCase()]) i = 1;
  const type = words[i].toLowerCase();
  const art = VOIE[type];
  if (!art) {
    // Nom sans type de voie reconnu (« Au Gré du Vent ») : cité tel quel.
    const name = words.join(" ");
    return { bare: `voie « ${name} »`, of: `de la voie « ${name} »` };
  }
  // Le type (et son adjectif) passe en minuscule ; le nom propre reste intact.
  const bare = words.map((w, k) => (k <= i ? lowerFirst(w) : w)).join(" ");
  // Adjectif devant : l'article suit son genre (« de la petite rue », « du petit chemin »).
  const adj = i === 1 ? words[0].toLowerCase() : "";
  const lead = adj ? (/^(petite|grande|vieille|nouvelle|ancienne)$/.test(adj) ? "de la" : "du") : art;
  return { bare, of: lead.endsWith("'") ? lead + bare : `${lead} ${bare}` };
}

/* ─── Numéros ─── */

// Espace insécable : « n° 8 », « 12 bis » et « : » ne sont jamais coupés en fin de ligne.
const NB = "\u00a0";

const SUFFIX = { b: "bis", bis: "bis", t: "ter", ter: "ter", q: "quater", quater: "quater" };

/** « 12b », « 12 BIS », « 12bis » → « 12 bis » ; autre saisie gardée telle quelle. */
export function numero(n) {
  const s = String(n || "").trim();
  const m = s.match(/^(\d+)\s*(bis|ter|quater|b|t|q)?$/i);
  if (!m) return s;
  return m[2] ? `${m[1]}${NB}${SUFFIX[m[2].toLowerCase()]}` : m[1];
}

/* ─── Déchets ─── */

/** Sigle (OM, DEEE, PAV, BHNS…) : gardé en majuscules. */
const isAcronym = (w) => /^[A-ZÀ-Ý0-9]{2,}$/.test(w);

// Anciens libellés corrigés (bons déjà enregistrés avec l'ancienne liste).
const DECHET_CORRIGE = { "Pot et emballage divers": "Pots et emballages divers" };

/** Déchet en minuscule dans la phrase (« Sac OM » → « sac OM »). */
export function dechet(label) {
  let s = String(label || "").trim().replace(/[.;,]+$/, "");
  s = DECHET_CORRIGE[s] || s;
  const first = s.split(/\s+/)[0] || "";
  return isAcronym(first) ? s : lowerFirst(s);
}

/** « matelas », « matelas et canapé », « matelas, canapé et sac OM »,
 *  « canapé ainsi que pots et emballages divers ». */
export function liste(items) {
  const xs = items.map(dechet).filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  const last = xs[xs.length - 1];
  // Dernier déchet qui contient déjà « et » : « ainsi que » évite « … et pots et emballages ».
  const joint = / et /.test(last) ? " ainsi que " : " et ";
  return `${xs.slice(0, -1).join(", ")}${joint}${last}`;
}

/* ─── Ligne complète ─── */

// Lieux qui se rattachent à la voie (« sur le trottoir de la rue… »), dans
// l'ordre où on les dit : du plus précis au plus général.
const LIEUX = [
  ["pav", "au pied du PAV"],
  ["entre", "entre deux maisons"],
  ["trottoir", "sur le trottoir"],
  ["chaussee", "sur la chaussée"],
];

/** Précision libre : en minuscule (sauf sigle), sans ponctuation finale. */
function libre(text) {
  const s = String(text || "").trim().replace(/[.;,:]+$/, "");
  if (!s) return "";
  const first = s.split(/\s+/)[0];
  return isAcronym(first) ? s : lowerFirst(s);
}

/**
 * Phrase de lieu à partir des éléments saisis.
 * @param {{rue:string, numero?:string, keys?:string[], custom?:string}} p
 */
export function lieu({ rue, numero: n = "", keys = [], custom = "" }) {
  const v = voie(rue);
  const num = numero(n);
  const has = (k) => keys.includes(k);
  const lieux = LIEUX.filter(([k]) => has(k)).map(([, t]) => t);

  // Point d'ancrage : ce qui relie le dépôt à l'adresse.
  let ancre;
  if (has("devant") || has("face")) {
    // « Devant » prime si les deux sont cochés (le n° désigne le même immeuble).
    const devant = has("devant");
    ancre = num
      ? `${devant ? "devant le" : "en face du"} n°${NB}${num} ${v.of}`
      : `${devant ? "devant une" : "en face d'une"} habitation ${v.of}`;
  } else if (has("angle")) {
    ancre = `à l'angle ${v.of}` + (num ? `, à hauteur du n°${NB}${num}` : "");
  } else if (lieux.length) {
    ancre = num ? `à hauteur du n°${NB}${num} ${v.of}` : null; // null : « … de la rue X »
  } else {
    ancre = num ? `${num}, ${v.bare}` : v.bare;
  }

  let phrase;
  if (!lieux.length) phrase = ancre;
  else if (ancre === null) phrase = `${lieux.join(", ")} ${v.of}`;
  else phrase = `${lieux.join(", ")}, ${ancre}`;

  const extra = libre(custom);
  if (extra) phrase += `, ${extra}`;
  return upperFirst(phrase);
}

/** Ligne du rapport : « Lieu : déchets. » */
export function ligne(p, wastes) {
  const l = liste(wastes || []);
  return `${lieu(p)}${NB}: ${l}.`;
}

/* ─── Dates ─── */

/** « 2026-11-17 » → « mardi 17 novembre 2026 » (« 1er » pour le premier du mois). */
export function dateLongue(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.replace(/^(\S+) 1 /, "$1 1er ");
}
