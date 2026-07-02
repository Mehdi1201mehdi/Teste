// Secteurs de la Brigade Verte : couleurs, titres, et résolution géographique
// (point-in-polygon sur les contours WFS) avec repli sur le secteur de la rue.

import { fetchSectorContours, geocodeAddress } from "./api.js";

export const SECTEURS = ["CENTRE", "OUEST", "NORD", "EST", "SUD"];

export const COLOR = {
  CENTRE: "#8b5cf6",
  OUEST: "#2563eb",
  NORD: "#16a34a",
  EST: "#ef4444",
  SUD: "#f59e0b",
};

export const TITRE = {
  CENTRE: "Secteur Centre",
  OUEST: "Secteur Ouest",
  NORD: "Secteur Nord",
  EST: "Secteur Est",
  SUD: "Secteur Sud",
};

let secteursGeo = null;

export async function loadSectorContours() {
  secteursGeo = await fetchSectorContours();
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
  for (const poly of polys) {
    if (pointInRing(pt, poly[0])) {
      let hole = false;
      for (let k = 1; k < poly.length; k++) if (pointInRing(pt, poly[k])) hole = true;
      if (!hole) return true;
    }
  }
  return false;
}

function propSector(p) {
  const v = Object.values(p || {})
    .map((x) => String(x || "").toUpperCase())
    .join(" ");
  for (const s of SECTEURS) if (v.includes(s)) return s;
  return null;
}

function secteurDuPoint(lon, lat) {
  if (secteursGeo) {
    for (const f of secteursGeo.features || []) {
      if (pointInPoly([lon, lat], f.geometry)) return propSector(f.properties) || null;
    }
  }
  return null;
}

/**
 * Détermine le secteur d'une adresse : géocodage + point-in-polygon si en ligne,
 * sinon repli immédiat sur le secteur déjà associé à la rue (mode hors ligne).
 */
export async function resolveSector(rue, numero) {
  if (!rue) return null;
  if (!numero) return rue.secteur || null;
  const coords = await geocodeAddress(numero, rue.rue);
  if (coords) {
    const [lon, lat] = coords;
    const sec = secteurDuPoint(lon, lat) || rue.secteur;
    if (sec) return sec;
  }
  return rue.secteur || null;
}
