// Génération du texte de signalement : format strictement identique à l'outil
// existant, avec les précisions et déchets séparés par des virgules (jamais par "+").

import { $ } from "./utils.js";
import { state } from "./storage.js";
import { SECTEURS, TITRE } from "./sectors.js";
import { adresseText, bpLine } from "./bp.js";

function dateFr() {
  const v = $("date").value;
  if (!v) return "";
  const [a, m, j] = v.split("-");
  return `${j}/${m}/${a}`;
}

export function generateMail() {
  const mailEl = $("mail");
  const mailSideEl = $("mailSide");
  if (!state.bps.length) {
    const empty = "(Ajoutez des BP pour générer le texte.)";
    mailEl.textContent = empty;
    mailSideEl.textContent = empty;
    return;
  }
  let t = "Bonjour,\n\n";
  t += `Lors de notre îlotage du ${dateFr()} nous avons constaté des dépôts sauvages dans les rues suivantes :\n`;
  SECTEURS.forEach((sec) => {
    const list = state.bps.filter((b) => b.secteur === sec);
    if (!list.length) return;
    t += `\n${TITRE[sec]} :\n`;
    list.forEach((b) => {
      t += `   • ${adresseText(b)} : ${bpLine(b)}\n`;
    });
  });
  t += "\nCordialement.";
  mailEl.textContent = t;
  mailSideEl.textContent = t;
}
