// Génère brigade-verte-v3/data/streets-geo.json : le tracé réel de chaque rue
// de l'application, d'après l'IGN (BD TOPO® V3, tronçons de route, nom BAN).
//
//   node tools/build-streets-geo.mjs
//
// Source : Géoplateforme IGN, service WFS public (sans clé), licence Ouverte
// Etalab 2.0. Lancé par le workflow « Tracé des rues (IGN) » : à relancer
// quand des rues sont créées ou renommées. Rien n'est appelé à l'exécution de
// l'application : le fichier est embarqué et fonctionne hors connexion.

import { readFile, writeFile } from "node:fs/promises";
import { normName } from "../brigade-verte-v3/js/streetgeo.js";

const APP = new URL("../brigade-verte-v3/", import.meta.url);
const INSEE = "80021"; // Amiens
const PAGE = 2000;
const WFS =
  "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature" +
  "&TYPENAMES=BDTOPO_V3:troncon_de_route&OUTPUTFORMAT=application/json" +
  "&PROPERTYNAME=nom_voie_ban_gauche,nom_voie_ban_droite,geometrie&SORTBY=cleabs" +
  "&CQL_FILTER=" + encodeURIComponent(`insee_commune_gauche='${INSEE}' OR insee_commune_droite='${INSEE}'`);

async function fetchPage(start, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`${WFS}&COUNT=${PAGE}&STARTINDEX=${start}`, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()).features || [];
    } catch (e) {
      if (i >= tries) throw e;
      console.warn(`page ${start} : ${e.message} — nouvel essai`);
      await new Promise((ok) => setTimeout(ok, 3000 * i));
    }
  }
}

/** Ligne [lon, lat] → entiers 1e-5 degré (≈ 1 m) delta-encodés. */
export function encodeLine(coords) {
  const enc = [];
  let px = 0;
  let py = 0;
  let lx = null;
  let ly = null;
  for (const c of coords) {
    const x = Math.round(c[0] * 1e5);
    const y = Math.round(c[1] * 1e5);
    if (x === lx && y === ly) continue;
    enc.push(x - px, y - py);
    px = x;
    py = y;
    lx = x;
    ly = y;
  }
  return enc.length >= 4 ? enc : null;
}

/** Associe les tronçons aux rues de l'application (nom BAN normalisé). */
export function buildGeo(streets, features) {
  const idx = new Map(streets.map((r) => [normName(r.rue), r.rue]));
  const s = {};
  for (const f of features) {
    const p = f.properties || {};
    const names = new Set([p.nom_voie_ban_gauche, p.nom_voie_ban_droite].filter(Boolean).map((n) => idx.get(normName(n))).filter(Boolean));
    if (!names.size || !f.geometry) continue;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const line of lines) {
      const enc = encodeLine(line);
      if (!enc) continue;
      names.forEach((n) => (s[n] ||= []).push(enc));
    }
  }
  return s;
}

async function main() {
  const streets = JSON.parse(await readFile(new URL("data/streets.json", APP), "utf8"));
  let features = [];
  for (let start = 0; ; start += PAGE) {
    const page = await fetchPage(start);
    features = features.concat(page);
    console.log(`tronçons reçus : ${features.length}`);
    if (page.length < PAGE) break;
  }
  const s = buildGeo(streets, features);
  const covered = Object.keys(s).length;
  // Garde-fou : un service partiellement indisponible ne doit pas écraser un bon fichier.
  if (covered < streets.length * 0.85) throw new Error(`couverture insuffisante (${covered}/${streets.length}) — fichier non modifié`);
  const out = {
    v: 1,
    source: "IGN BD TOPO® V3 — troncon_de_route (nom_voie_ban), Géoplateforme WFS",
    licence: "Licence Ouverte Etalab 2.0",
    extrait: new Date().toISOString().slice(0, 10),
    format: "s[rue] = lignes [lon, lat] en entiers 1e-5 degré, delta-encodées",
    s,
  };
  await writeFile(new URL("data/streets-geo.json", APP), JSON.stringify(out));
  const missing = streets.filter((r) => !s[r.rue]).map((r) => r.rue);
  console.log(`rues avec tracé : ${covered}/${streets.length}`);
  console.log(`sans tracé (point de référence conservé) : ${missing.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
