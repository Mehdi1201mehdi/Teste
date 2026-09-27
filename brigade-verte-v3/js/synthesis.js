// Synthèse de tournée — texte factuel généré à partir des données, sans IA
// externe et sans rien inventer : une information absente est dite absente.
// Elle complète le message historique (inchangé) : responsable, impression.

import { SECTEURS, TITRE } from "./sectors.js";
import { countBy, tourDuration, meanPerTour } from "./analytics.js";
import { dateFr } from "./utils.js";

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null);
const dur = (m) => (m == null ? null : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`);
const pl = (n, one, many = one + "s") => `${n} ${n > 1 ? many : one}`;

/**
 * @param {object} t  { date, startedAt, closedAt, bps }
 * @param {object} ctx { previousTours: tournées clôturées antérieures,
 *                       priorities: Map(id → {level}), recurrent: Map(id → zone),
 *                       quality: résultat tourQuality }
 * @returns {{ title, lines: string[] }}
 */
export function tourSummary(t, ctx = {}) {
  const bps = t.bps || [];
  const lines = [];
  const n = bps.length;
  const title = `Synthèse — îlotage du ${dateFr(t.date) || "date non renseignée"}`;
  if (!n) return { title, lines: ["Aucun dépôt relevé."] };

  // Horaires et durée
  const first = bps.map((b) => b.createdAt).filter(Boolean).sort()[0];
  const last = bps.map((b) => b.createdAt).filter(Boolean).sort().pop();
  const start = t.startedAt || first;
  const end = t.closedAt || last;
  const d = tourDuration({ startedAt: start, closedAt: end });
  lines.push(
    start && end
      ? `Horaires : ${hm(start)} – ${hm(end)}${d != null ? ` (${dur(d)})` : ""}.`
      : "Horaires : information non renseignée (bons saisis avant l'horodatage).",
  );

  // Volume et lieux
  const streets = new Set(bps.map((b) => b.rue)).size;
  const bySector = SECTEURS.map((s) => ({ s, k: bps.filter((b) => b.secteur === s).length })).filter((x) => x.k);
  lines.push(`${pl(n, "dépôt relevé", "dépôts relevés")} dans ${pl(streets, "rue")} ; ${bySector.map((x) => `${TITRE[x.s]} : ${x.k}`).join(", ")}.`);

  const wastes = countBy(bps.map((bp) => ({ bp })), ({ bp }) => bp.wastes, 3);
  if (wastes.length) lines.push(`Déchets les plus fréquents : ${wastes.map((w) => `${w.key} (${w.n})`).join(", ")}.`);

  // Priorités
  const prio = ctx.priorities;
  if (prio) {
    const high = bps.filter((b) => ["critique", "haute"].includes(prio.get(b.id)?.level.key));
    lines.push(
      high.length
        ? `Points prioritaires (indice interne) : ${high.map((b) => `${b.numero ? b.numero + " " : ""}${b.rue} — ${prio.get(b.id).level.label.toLowerCase()}`).join(" ; ")}.`
        : "Aucun point de priorité haute ou critique selon l'indice interne.",
    );
  }

  // Récidives
  const rec = ctx.recurrent;
  if (rec) {
    const r = bps.filter((b) => rec.has(b.id));
    if (r.length) {
      lines.push(
        `Zones potentiellement récurrentes : ${r
          .map((b) => {
            const z = rec.get(b.id);
            return `${b.numero ? b.numero + " " : ""}${b.rue} (${z.count} dépôts depuis le ${dateFr(z.first)})`;
          })
          .join(" ; ")}.`,
      );
    }
  }

  // Qualité des données
  const q = ctx.quality;
  if (q && q.score != null) {
    const warn = q.errors.length + q.warnings.length;
    lines.push(`Complétude des données : ${q.score} %${warn ? ` — ${pl(warn, "bon à vérifier", "bons à vérifier")}` : ""}.`);
  }

  // Évolution
  const prev = (ctx.previousTours || []).slice(0, 5);
  const mean = meanPerTour(prev);
  if (mean != null) {
    const diff = Math.round(((n - mean) / mean) * 100);
    lines.push(`Par rapport à la moyenne des ${pl(prev.length, "tournée précédente", "tournées précédentes")} (${String(mean).replace(".", ",")} dépôts) : ${diff > 0 ? "+" : ""}${diff} %.`);
  } else {
    lines.push("Évolution : aucune tournée précédente enregistrée sur cet appareil.");
  }

  return { title, lines };
}
