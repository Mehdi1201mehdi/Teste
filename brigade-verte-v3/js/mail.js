// Texte du signalement — format historique inchangé, octet pour octet :
// regroupement par secteur dans l'ordre CENTRE, OUEST, NORD, EST, SUD,
// précisions et déchets séparés par des virgules.

import { state } from "./storage.js";
import { SECTEURS, TITRE } from "./sectors.js";
import { mailLine } from "./bp.js";
import { dateFr } from "./utils.js";

export function autoMailText() {
  if (!state.bps.length) return "(Ajoutez des BP pour générer le texte.)";
  let t = "Bonjour,\n\n";
  t += `Lors de notre îlotage du ${dateFr(state.date)} nous avons constaté des dépôts sauvages dans les rues suivantes :\n`;
  SECTEURS.forEach((sec) => {
    const list = state.bps.filter((b) => b.secteur === sec);
    if (!list.length) return;
    t += `\n${TITRE[sec]} :\n`;
    list.forEach((b) => {
      t += `   • ${mailLine(b)}\n`;
    });
  });
  t += "\nCordialement.";
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
