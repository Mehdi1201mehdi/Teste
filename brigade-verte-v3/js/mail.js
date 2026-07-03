// Génération du texte de signalement : format strictement identique à l'outil
// existant, avec les précisions et déchets séparés par des virgules (jamais par "+").

import { $ } from "./utils.js";
import { state } from "./storage.js";
import { SECTEURS, TITRE } from "./sectors.js";
import { mailLine } from "./bp.js";

function dateFr() {
  const v = $("date").value;
  if (!v) return "";
  const [a, m, j] = v.split("-");
  return `${j}/${m}/${a}`;
}

/** Texte généré automatiquement à partir des BP (format historique inchangé). */
export function autoMailText() {
  if (!state.bps.length) return "(Ajoutez des BP pour générer le texte.)";
  let t = "Bonjour,\n\n";
  t += `Lors de notre îlotage du ${dateFr()} nous avons constaté des dépôts sauvages dans les rues suivantes :\n`;
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

/**
 * Affiche le texte : la version modifiée à la main (state.mailCustom) est
 * prioritaire ; sinon le texte automatique. L'aperçu latéral suit.
 */
export function generateMail() {
  const t = state.mailCustom || autoMailText();
  $("mail").textContent = t;
  $("mailSide").textContent = t;
}
