// Texte du signalement — regroupement par secteur dans l'ordre CENTRE, OUEST,
// NORD, EST, SUD ; chaque ligne rédigée en français par phrase.js.

import { state } from "./storage.js";
import { SECTEURS, TITRE } from "./sectors.js";
import { mailLine } from "./bp.js";
import { dateFr } from "./utils.js";
import { dateLongue } from "./phrase.js";

export function autoMailText() {
  const n = state.bps.length;
  if (!n) return "(Ajoutez des bons de passage pour générer le texte.)";
  const quand = dateLongue(state.date) || dateFr(state.date);
  let t = "Bonjour,\n\n";
  t += n > 1
    ? `Lors de notre îlotage du ${quand}, nous avons constaté des dépôts sauvages aux emplacements suivants :\n`
    : `Lors de notre îlotage du ${quand}, nous avons constaté un dépôt sauvage à l'emplacement suivant :\n`;
  SECTEURS.forEach((sec) => {
    const list = state.bps.filter((b) => b.secteur === sec);
    if (!list.length) return;
    t += `\n${TITRE[sec]} :\n`;
    list.forEach((b) => {
      t += `   • ${mailLine(b)}\n`;
    });
  });
  t += `\nNous vous remercions de bien vouloir procéder ${n > 1 ? "à leur enlèvement" : "à son enlèvement"}.\n\nCordialement.`;
  return t;
}

/** Texte affiché/envoyé : la version modifiée à la main est prioritaire. */
export function mailText() {
  return state.mailCustom || autoMailText();
}

export function mailSubject() {
  const d = dateFr(state.date);
  return d ? `Dépôts sauvages — îlotage du ${d}` : "Dépôts sauvages";
}
