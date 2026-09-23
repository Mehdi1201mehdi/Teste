// Secteurs de la Brigade Verte : couleurs, titres, et résolution géographique
// (point-in-polygon sur les contours WFS) avec repli sur le secteur de la rue.

import { geocodeAddress } from "./api.js";

export const SECTEURS = ["CENTRE", "OUEST", "NORD", "EST", "SUD"];

// Teintes minérales (identiques à tokens.css) : pastilles sur papier.
export const COLOR = {
  CENTRE: "#6b4fc8",
  OUEST: "#2563a8",
  NORD: "#2e7d4f",
  EST: "#b8412f",
  SUD: "#9a6210",
};
export const COLOR_NONE = "#6b7280";

/** Variable CSS `--sec` prête à poser dans un attribut style. */
export function secStyle(s) {
  return `--sec:${COLOR[s] || COLOR_NONE}`;
}

export const TITRE = {
  CENTRE: "Secteur Centre",
  OUEST: "Secteur Ouest",
  NORD: "Secteur Nord",
  EST: "Secteur Est",
  SUD: "Secteur Sud",
};

let secteursGeo = null;

/** Contours officiels des 5 secteurs (Amiens Métropole), embarqués : hors ligne. */
export async function loadSectorContours() {
  try {
    const r = await fetch("data/secteurs.geojson");
    secteursGeo = r.ok ? await r.json() : null;
  } catch (e) {
    secteursGeo = null;
  }
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPoly(pt, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((h) => pointInRing(pt, h)));
}

/** Secteur contenant un point [lon, lat] — propriété « secteur » explicite. */
export function secteurDuPoint(lon, lat) {
  for (const f of secteursGeo?.features || []) {
    if (pointInPoly([lon, lat], f.geometry)) {
      const s = String(f.properties?.secteur || "").toUpperCase();
      return SECTEURS.includes(s) ? s : null;
    }
  }
  return null;
}

/**
 * Secteur réel d'une adresse : géocodage du numéro (en ligne) puis contour
 * officiel ; sinon secteur de référence de la rue (hors ligne / sans numéro).
 */
export async function resolveSector(rue, numero) {
  if (!rue) return null;
  if (!numero) return rue.secteur || null;
  const coords = await geocodeAddress(numero, rue.rue);
  if (coords) {
    const [lon, lat] = coords;
    const sec = secteurDuPoint(lon, lat);
    if (sec) return sec;
  }
  return rue.secteur || null;
}
