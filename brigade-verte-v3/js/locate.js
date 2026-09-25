// « Ma position » → rue, numéro, secteur. Chaîne à plusieurs niveaux :
//   1 · GPS haute précision, mesure fraîche (geo.js)
//   2 · géocodage inverse officiel (Géoplateforme / BAN) : rue + numéro
//   3 · rapprochement avec les rues connues de l'application
//   4 · distance au TRACÉ RÉEL des rues (IGN BD TOPO, embarqué, hors ligne)
//   5 · décision prudente (streetgeo.decideStreet) : si la précision ne permet
//       pas d'affirmer la rue, l'agent confirme parmi les candidates.

import { createStreetIndex, decideStreet, readReverse } from "./streetgeo.js";
import { getCurrentPosition, validatePositionAccuracy } from "./geo.js";
import { reverseGeocode } from "./api.js";
import { secteurDuPoint } from "./sectors.js";

let streetList = [];
let index = createStreetIndex([]);
let geoPromise = null;

/** Rues de l'application (point de référence seul, en attendant le tracé). */
export function initStreetIndex(streets) {
  streetList = streets || [];
  index = createStreetIndex(streetList);
}

/**
 * Tracé réel des rues (≈ 100 Ko compressés), chargé à la demande puis gardé :
 * le service worker le met en cache pour le hors-connexion.
 */
export function loadStreetGeometry() {
  if (!geoPromise) {
    geoPromise = fetch("data/streets-geo.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((geo) => {
        if (geo?.s) index = createStreetIndex(streetList, geo);
        return index.hasGeometry;
      })
      .catch(() => {
        geoPromise = null; // nouvel essai à la prochaine demande
        return false;
      });
  }
  return geoPromise;
}

/** Rues les plus proches d'un point (tracé réel si chargé). */
export function findNearestStreets(lat, lon, n = 5) {
  return index.nearest(lat, lon, n);
}

export function geometryReady() {
  return index.hasGeometry;
}

/**
 * Secteur du lieu : contour officiel au point mesuré quand la mesure est assez
 * précise ET que la rue retenue passe bien là ; sinon secteur de référence de
 * la rue (une rue peut traverser deux secteurs).
 */
export function resolveSectorAt(street, fix, streetDistance = Infinity) {
  if (!street) return null;
  const v = validatePositionAccuracy(fix?.accuracy);
  if (fix && v.confident && streetDistance <= fix.accuracy + 12) {
    const s = secteurDuPoint(fix.lon, fix.lat);
    if (s) return s;
  }
  return street.secteur || null;
}

/**
 * Chaîne complète. `onFix` reçoit chaque mesure (affichage du cercle) ;
 * `onStage` les étapes (« position », « adresse ») pour l'interface.
 * Résout avec { fix, decision, reverse, reverseError, geometry }.
 * Les erreurs GPS (LocationError) sont propagées telles quelles.
 */
export async function resolveStreet({ onFix, onStage, signal } = {}) {
  const geometry = loadStreetGeometry(); // en parallèle du GPS
  onStage?.("position");
  const fix = await getCurrentPosition({ onFix, signal });
  const hasGeometry = await geometry;
  const near = findNearestStreets(fix.lat, fix.lon, 6);

  let reverse = null;
  let reverseError = null;
  if (validatePositionAccuracy(fix.accuracy).usable) {
    onStage?.("adresse");
    try {
      reverse = readReverse(await reverseGeocode(fix.lat, fix.lon), index);
    } catch (e) {
      reverseError = e; // hors ligne / service indisponible : on continue sans
    }
  }
  const decision = decideStreet(fix, near, reverse);
  if (decision.street) {
    const d = decision.candidates.find((c) => c.r.rue === decision.street.rue)?.d ?? Infinity;
    decision.secteur = resolveSectorAt(decision.street, fix, d);
  }
  return { fix, decision, reverse, reverseError, geometry: hasGeometry };
}
