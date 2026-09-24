// Territoire : vraie carte d'Amiens.
// · Fond : Plan IGN (Géoplateforme, gratuit, sans clé), adouci aux couleurs de l'app.
// · Quartiers : les 27 quartiers officiels d'Amiens Métropole (data/quartiers.geojson),
//   teintés par secteur Brigade Verte, avec leur nom ; limites de secteur en pointillé.
// · Dépôts : balises orange numérotées ; rue choisie : mire ; agent : point GPS.
// · Hors connexion : si le fond IGN ne charge pas, les 1 437 rues embarquées
//   s'affichent en points — la carte reste utilisable sans réseau.
// Toucher la carte propose les rues les plus proches (jamais de choix imposé).
// Moteur : Leaflet 1.9 (embarqué dans js/vendor), gestes natifs iOS / Android / souris.

import { esc } from "./utils.js";

const L = window.L;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Couleurs de secteur sur fond clair (identiques à tokens.css)
const SEC = { CENTRE: "#6b4fc8", OUEST: "#2563a8", NORD: "#2e7d4f", EST: "#b8412f", SUD: "#9a6210" };
const SEC_NONE = "#6b7280";

const IGN_URL =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png" +
  "&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

let host, map;
let streets = [];
let byName = new Map();
let quartiers = []; // [{ nom, secteur, layer, rings }]
let quartierLayer, labelLayer, dotLayer, markerLayer;
let onPick = () => {};
let pinClick = () => {};
let targetStreet = null;
let targetMarker = null;
let meMarker = null;
let probeMarker = null;
let pinsData = [];
let pinMarkers = [];
let hotQuartier = null;
let tileErrors = 0;
let tilesOk = false;

/* ───────────── Géométrie ───────────── */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans un (Multi)Polygon GeoJSON [lon, lat]. */
export function pointInGeometry(lon, lat, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some((poly) => pointInRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => pointInRing(lon, lat, h)));
}

/** Point d'étiquette : centre de l'anneau principal, ramené dans le polygone si besoin. */
function labelPoint(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let best = polys[0][0];
  let bestArea = 0;
  polys.forEach((p) => {
    const r = p[0];
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a);
      best = r;
    }
  });
  let cx = 0;
  let cy = 0;
  best.forEach(([x, y]) => {
    cx += x;
    cy += y;
  });
  cx /= best.length;
  cy /= best.length;
  if (pointInRing(cx, cy, best)) return [cy, cx];
  // Repli : balayage horizontal au niveau du centre, milieu du plus long segment intérieur.
  const xs = [];
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const [xi, yi] = best[i];
    const [xj, yj] = best[j];
    if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let mid = cx;
  let span = 0;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > span) {
      span = xs[k + 1] - xs[k];
      mid = (xs[k] + xs[k + 1]) / 2;
    }
  }
  return [cy, mid];
}

function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const firstSector = (s) => String(s || "").split(",")[0].trim().toUpperCase();

/* ───────────── Initialisation ───────────── */
export function initMap(container, data, opts = {}) {
  host = container;
  onPick = opts.onPick || onPick;
  pinClick = opts.onPinClick || pinClick;
  streets = (data || []).filter((r) => typeof r.lat === "number" && typeof r.lon === "number");
  byName = new Map(streets.map((r) => [r.rue, r]));
  if (!L) {
    host.innerHTML = "";
    return;
  }

  map = L.map(host, {
    zoomControl: false,
    attributionControl: true,
    minZoom: 11,
    maxZoom: 19,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    bounceAtZoomLimits: false,
    maxBounds: L.latLngBounds([49.8, 2.12], [50.0, 2.46]),
    maxBoundsViscosity: 0.8,
    fadeAnimation: !reduceMotion(),
    zoomAnimation: !reduceMotion(),
    markerZoomAnimation: !reduceMotion(),
  });
  map.attributionControl.setPrefix(false);

  // Fond IGN
  const tiles = L.tileLayer(IGN_URL, {
    maxZoom: 19,
    maxNativeZoom: 19,
    crossOrigin: "anonymous",
    className: "ignTiles",
    attribution: "© IGN – Géoplateforme · Quartiers © Amiens Métropole",
    keepBuffer: 3,
  });
  tiles.on("tileload", () => {
    if (tilesOk) return;
    tilesOk = true;
    host.classList.add("has-tiles");
    host.classList.remove("no-tiles");
    syncDots();
  });
  tiles.on("tileerror", () => {
    tileErrors++;
    if (!tilesOk && tileErrors > 3) {
      host.classList.add("no-tiles");
      syncDots();
    }
  });
  tiles.addTo(map);
  if (!navigator.onLine) host.classList.add("no-tiles");

  // Rues en points (visibles seulement si le fond ne charge pas — voir map.css)
  const renderer = L.canvas({ padding: 0.3 });
  dotLayer = L.layerGroup(
    streets.map((r) =>
      L.circleMarker([r.lat, r.lon], {
        renderer,
        radius: 2.4,
        stroke: false,
        fillColor: SEC[r.secteur] || SEC_NONE,
        fillOpacity: 0.75,
        interactive: false,
        className: "streetDot",
      }),
    ),
  );
  dotLayer.addTo(map);
  syncDots();

  quartierLayer = L.layerGroup().addTo(map);
  labelLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  whenSized(() => map.fitBounds(cityBounds(), { padding: [16, 16], animate: false }));
  map.on("click", onMapClick);
  map.on("zoomend", syncLabels);
  map.on("resize", () => {
    applyPendingView();
    syncLabels();
  });

  // pan par défaut : le CENTRE est conservé quand la carte se replie/se redéploie
  // (clavier mobile) — la rue choisie reste au milieu au lieu de filer sous le compteur.
  new ResizeObserver(() => map.invalidateSize({ animate: false })).observe(host);
  window.addEventListener("online", syncDots);
  window.addEventListener("offline", syncDots);
}

function syncDots() {
  if (!host) return;
  if (!navigator.onLine && !tilesOk) host.classList.add("no-tiles");
  const show = host.classList.contains("no-tiles");
  if (!dotLayer) return;
  if (show && !map.hasLayer(dotLayer)) dotLayer.addTo(map);
  if (!show && map.hasLayer(dotLayer)) map.removeLayer(dotLayer);
}

function cityBounds() {
  if (quartiers.length) return L.featureGroup(quartiers.map((q) => q.layer)).getBounds();
  if (streets.length) return L.latLngBounds(streets.map((r) => [r.lat, r.lon]));
  return L.latLngBounds([49.85, 2.23], [49.95, 2.35]);
}

/** Charge les 27 quartiers officiels et les limites de secteurs (embarqués). */
export async function loadAreas() {
  if (!map) return;
  try {
    const [q, s] = await Promise.all([
      fetch("data/quartiers.geojson").then((r) => r.json()),
      fetch("data/secteurs.geojson").then((r) => r.json()),
    ]);
    // Limites de secteur : trait pointillé plus marqué
    L.geoJSON(s, {
      interactive: false,
      style: () => ({ className: "sectorEdge", fill: false, color: "#111915", weight: 2, opacity: 0.45, dashArray: "6 5" }),
    }).addTo(quartierLayer);

    quartiers = q.features.map((f) => {
      const sec = firstSector(f.properties.secteur);
      const color = SEC[sec] || SEC_NONE;
      const layer = L.geoJSON(f, {
        interactive: false,
        style: () => ({ className: "quartier", color, weight: 1.5, opacity: 0.7, fillColor: color, fillOpacity: 0.09 }),
      });
      layer.addTo(quartierLayer);
      const [lat, lon] = labelPoint(f.geometry);
      const label = L.marker([lat, lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "quartierLabel",
          html: `<span style="--sec:${color}">${esc(f.properties.nom.replace(/\//g, " / "))}</span>`,
          iconSize: null,
        }),
      });
      label.addTo(labelLayer);
      const b = layer.getBounds();
      const area = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
      return { nom: f.properties.nom, secteur: sec, secteurs: f.properties.secteur, geom: f.geometry, layer, label, color, area };
    });
    syncLabels();
    // Les largeurs changent quand la police mono arrive (souvent après fonts.ready,
    // car elle n'est demandée qu'à l'affichage des noms) : on remesure à son arrivée.
    const resync = () => requestAnimationFrame(syncLabels);
    document.fonts?.load('500 10px "JetBrains Mono"').then(resync, () => {});
    document.fonts?.addEventListener?.("loadingdone", resync);
    if (!pinsData.length && !targetStreet) whenSized(() => map.fitBounds(cityBounds(), { padding: [16, 16], animate: false }));
  } catch (e) {
    /* données absentes : la carte fonctionne sans les quartiers */
  }
}

function syncLabels() {
  if (!map) return;
  const z = map.getZoom();
  host.dataset.zoom = z >= 15 ? "near" : z >= 12.5 ? "mid" : "far";
  // Anti-chevauchement : les grands quartiers d'abord, un nom qui en recouvre
  // un autre est masqué (il réapparaît en zoomant). Le quartier actif gagne toujours.
  const shown = [];
  const pad = 4;
  [...quartiers]
    .sort((a, b) => (b.nom === hotQuartier) - (a.nom === hotQuartier) || b.area - a.area)
    .forEach((q) => {
      const el = q.label.getElement()?.firstElementChild;
      if (!el) return;
      el.classList.remove("is-hidden");
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const hit = shown.some((o) => r.left < o.right + pad && r.right > o.left - pad && r.top < o.bottom + pad && r.bottom > o.top - pad);
      if (hit) el.classList.add("is-hidden");
      else shown.push(r);
    });
}

/** Quartier officiel contenant un point (ou null). */
export function quartierAt(lat, lon) {
  const q = quartiers.find((x) => pointInGeometry(lon, lat, x.geom));
  return q ? q.nom : null;
}

/** Quartier d'une rue (par son point de référence). */
export function quartierOfStreet(name) {
  const r = byName.get(name);
  return r ? quartierAt(r.lat, r.lon) : null;
}

export const quartiersReady = () => quartiers.length > 0;

function highlightQuartier(nom) {
  hotQuartier = nom;
  quartiers.forEach((q) => {
    const on = q.nom === nom;
    q.layer.setStyle({ fillOpacity: on ? 0.24 : 0.09, weight: on ? 3 : 1.5, opacity: on ? 1 : 0.7 });
    q.label.getElement()?.classList.toggle("is-hot", on);
  });
  requestAnimationFrame(syncLabels);
}

/* ───────────── Vue ─────────────
   Une carte masquée (vue Rapport sur mobile) a une taille nulle : y lancer un
   flyTo produit des coordonnées NaN. On met alors le cadrage de côté et on
   l'applique, sans animation, dès que la carte réapparaît. */
let pendingView = null;
function whenSized(fn) {
  const s = map.getSize();
  if (!s.x || !s.y) {
    pendingView = fn;
    return;
  }
  pendingView = null;
  fn(false);
}
function applyPendingView() {
  if (!pendingView) return;
  const s = map.getSize();
  if (!s.x || !s.y) return;
  const fn = pendingView;
  pendingView = null;
  fn(true);
}

function flyTo(lat, lon, zoom) {
  if (!map) return;
  whenSized((instant) => {
    const z = Math.max(map.getZoom(), zoom);
    if (instant || reduceMotion()) map.setView([lat, lon], z, { animate: false });
    else map.flyTo([lat, lon], z, { duration: 0.6, easeLinearity: 0.3 });
  });
}

function flyBounds(b, opts) {
  whenSized((instant) => {
    if (instant || reduceMotion()) map.fitBounds(b, { ...opts, animate: false });
    else map.flyToBounds(b, { ...opts, duration: 0.6 });
  });
}

export function fit() {
  if (!map) return;
  highlightQuartier(null);
  flyBounds(cityBounds(), { padding: [16, 16] });
}

/** Cadre la tournée : toutes les balises visibles. */
export function fitPins() {
  if (!map) return;
  const pts = pinsData.map((p) => byName.get(p.rue)).filter(Boolean);
  if (!pts.length) return fit();
  const b = L.latLngBounds(pts.map((r) => [r.lat, r.lon]));
  flyBounds(b.pad(0.25), { padding: [40, 40], maxZoom: 16 });
}

/* ───────────── Marqueurs ───────────── */
function pinIcon(i, cls) {
  return L.divIcon({
    className: `marker pin ${cls}`,
    html: `<svg viewBox="0 0 30 36" aria-hidden="true"><path class="body" d="M15 35s-12-11-12-20a12 12 0 0 1 24 0c0 9-12 20-12 20Z"/></svg><span>${i + 1}</span>`,
    iconSize: [30, 36],
    iconAnchor: [15, 35],
  });
}

/** Balises des dépôts : [{ rue, label }] dans l'ordre des BP. */
export function setPins(list, { fresh = -1, editing = null } = {}) {
  pinsData = list || [];
  if (!map) return;
  pinMarkers.forEach((m) => markerLayer.removeLayer(m));
  const seen = new Map();
  pinMarkers = [];
  pinsData.forEach((p, i) => {
    const r = byName.get(p.rue);
    if (!r) return;
    // Plusieurs dépôts dans la même rue : éventail de quelques mètres
    const k = seen.get(p.rue) || 0;
    seen.set(p.rue, k + 1);
    const ang = k * 2.4;
    const off = k ? 0.00012 + k * 0.00004 : 0;
    const cls = [i === fresh ? "is-new" : "", i === editing ? "is-editing" : ""].join(" ");
    const m = L.marker([r.lat + Math.sin(ang) * off, r.lon + Math.cos(ang) * off * 1.5], {
      icon: pinIcon(i, cls),
      title: p.label,
      keyboard: false,
      riseOnHover: true,
      zIndexOffset: 500 + i,
    });
    m.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      pinClick(i);
    });
    m.addTo(markerLayer);
    pinMarkers.push(m);
  });
}

/** Rue choisie : mire + vol vers elle. */
export function setTarget(name, { fly = true } = {}) {
  targetStreet = name ? byName.get(name) || null : null;
  if (!map) return;
  if (targetMarker) markerLayer.removeLayer(targetMarker);
  targetMarker = null;
  clearProbe();
  if (!targetStreet) return;
  targetMarker = L.marker([targetStreet.lat, targetStreet.lon], {
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
    icon: L.divIcon({
      className: "marker target",
      html: `<i class="ring"></i><i class="ring r2"></i><i class="core"></i><b class="targetName">${esc(targetStreet.rue)}</b>`,
      iconSize: [0, 0],
    }),
  }).addTo(markerLayer);
  highlightQuartier(quartierAt(targetStreet.lat, targetStreet.lon));
  if (fly) flyTo(targetStreet.lat, targetStreet.lon, 16);
}

/**
 * Position de l'agent + cercle de précision RÉEL (rayon = précision du capteur).
 * Appelé à chaque amélioration : le point glisse et le cercle se resserre au
 * lieu de sauter. Teinte du cercle selon la qualité (bonne / moyenne / faible).
 */
let meCircle = null;
let meTween = 0;
export function setMe(lat, lon, { fly = true, accuracy = null, quality = "good" } = {}) {
  if (!map) return;
  const first = !meMarker;
  if (first) {
    meMarker = L.marker([lat, lon], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 900,
      icon: L.divIcon({ className: "marker me", html: '<i class="halo"></i><i class="dot"></i>', iconSize: [0, 0] }),
    }).addTo(markerLayer);
  }
  if (accuracy != null) {
    if (!meCircle) {
      meCircle = L.circle([lat, lon], { radius: accuracy, interactive: false, className: "meAccuracy", weight: 1.5 }).addTo(markerLayer);
    }
    meCircle.getElement?.()?.setAttribute("data-quality", quality);
  }
  const from = meMarker.getLatLng();
  const r0 = meCircle ? meCircle.getRadius() : accuracy;
  cancelAnimationFrame(meTween);
  if (first || reduceMotion()) {
    meMarker.setLatLng([lat, lon]);
    meCircle?.setLatLng([lat, lon]).setRadius(accuracy ?? r0);
  } else {
    const t0 = performance.now();
    const D = 450;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / D);
      const e = 1 - Math.pow(1 - k, 3); // décélération
      const p = [from.lat + (lat - from.lat) * e, from.lng + (lon - from.lng) * e];
      meMarker.setLatLng(p);
      meCircle?.setLatLng(p).setRadius(r0 + ((accuracy ?? r0) - r0) * e);
      if (k < 1) meTween = requestAnimationFrame(step);
    };
    meTween = requestAnimationFrame(step);
  }
  if (fly) flyTo(lat, lon, accuracy > 120 ? 15 : 16.5);
}

/** État « recherche du signal » : anneau sur le bouton et message sur la carte. */
export function setLocating(on) {
  host?.classList.toggle("is-locating", !!on);
}

/** Estompe les autres secteurs (survol d'un groupe dans le rapport, choix manuel…). */
export function focusSector(s) {
  quartiers.forEach((q) => {
    const on = !s || q.secteurs.toUpperCase().includes(s);
    q.layer.setStyle({ fillOpacity: s ? (on ? 0.2 : 0.03) : q.nom === hotQuartier ? 0.24 : 0.09, opacity: on ? 0.8 : 0.25 });
  });
}

export function streetByName(name) {
  return byName.get(name) || null;
}

/** Les n rues les plus proches d'un point, avec la distance en mètres. */
export function nearestStreets(lat, lon, n = 5) {
  return streets
    .map((r) => ({ r, d: distM(lat, lon, r.lat, r.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

export function clearProbe() {
  if (probeMarker && map) markerLayer.removeLayer(probeMarker);
  probeMarker = null;
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  clearProbe();
  probeMarker = L.marker([lat, lng], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({ className: "marker probe", html: "<i></i>", iconSize: [0, 0] }),
  }).addTo(markerLayer);
  const quartier = quartierAt(lat, lng);
  highlightQuartier(quartier);
  onPick({ lat, lon: lng, quartier, list: nearestStreets(lat, lng, 5) });
}

/** Utilitaire de test / accessibilité : simule un toucher au centre de la vue. */
export function pickCenter() {
  if (!map) return;
  onMapClick({ latlng: map.getCenter() });
}
