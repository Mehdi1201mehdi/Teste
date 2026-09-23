// Territoire : carte d'Amiens tracée à partir de data/streets.json.
// · Une rue = un point lumineux, teinté par secteur (5 tracés SVG seulement :
//   rendu instantané, même sur un vieux téléphone).
// · Les dépôts relevés sont des balises numérotées en HTML, de taille constante.
// · Toucher la carte propose les rues les plus proches (sans jamais choisir
//   à la place de l'agent) ; glisser déplace, pincer ou molette zoome.
// Aucune tuile ni service externe : fonctionne hors connexion.

import { SECTEURS, TITRE } from "./sectors.js";
import { esc } from "./utils.js";

const NS = "http://www.w3.org/2000/svg";
const K = 111320; // mètres par degré de latitude
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let host, svg, overlay, markers, labelsEl;
let streets = [];
let byName = new Map();
let lat0 = 49.9, lon0 = 2.29, cosLat = Math.cos((lat0 * Math.PI) / 180);
let world = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
let view = { x: 0, y: 0, w: 1, h: 1 };
let size = { w: 1, h: 1 };
let onPick = () => {};
let pinClick = () => {};
let anim = 0;
let targetStreet = null;
let mePoint = null;
let probePoint = null;
let pinsData = [];
let newPinIndex = -1;
let editingIndex = null;

/* ───────────── Projection ───────────── */
const project = (lon, lat) => [(lon - lon0) * cosLat * K, (lat0 - lat) * K];
const unproject = (x, y) => [x / (cosLat * K) + lon0, lat0 - y / K];
const toScreen = (x, y) => [((x - view.x) / view.w) * size.w, ((y - view.y) / view.h) * size.h];
const toWorld = (sx, sy) => [view.x + (sx / size.w) * view.w, view.y + (sy / size.h) * view.h];

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

/* ───────────── Initialisation ───────────── */
export function initMap(container, data, opts = {}) {
  host = container;
  onPick = opts.onPick || onPick;
  pinClick = opts.onPinClick || pinClick;
  streets = (data || []).filter((r) => typeof r.lat === "number" && typeof r.lon === "number");
  byName = new Map(streets.map((r) => [r.rue, r]));
  if (!streets.length) {
    host.innerHTML = "";
    return;
  }

  const lats = streets.map((r) => r.lat);
  const lons = streets.map((r) => r.lon);
  lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  cosLat = Math.cos((lat0 * Math.PI) / 180);
  streets.forEach((r) => {
    const [x, y] = project(r.lon, r.lat);
    r._x = x;
    r._y = y;
  });
  const xs = streets.map((r) => r._x);
  const ys = streets.map((r) => r._y);
  world = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };

  host.innerHTML = "";
  svg = el("svg", { "aria-hidden": "true", focusable: "false", preserveAspectRatio: "none" }, host);

  // Graticule tous les 500 m, légèrement débordant
  const grid = el("g", { class: "grid" }, svg);
  const step = 500;
  const gx0 = Math.floor((world.minX - 3000) / step) * step;
  const gy0 = Math.floor((world.minY - 3000) / step) * step;
  for (let x = gx0; x <= world.maxX + 3000; x += step) el("line", { x1: x, x2: x, y1: gy0, y2: world.maxY + 3000 }, grid);
  for (let y = gy0; y <= world.maxY + 3000; y += step) el("line", { y1: y, y2: y, x1: gx0, x2: world.maxX + 3000 }, grid);

  // Rues : un tracé par secteur, chaque point = segment de longueur nulle à bout rond
  const g = el("g", { class: "streets" }, svg);
  [...SECTEURS, null].forEach((s) => {
    const d = streets
      .filter((r) => (r.secteur || null) === s)
      .map((r) => `M${r._x.toFixed(1)} ${r._y.toFixed(1)}h0`)
      .join("");
    if (!d) return;
    el("path", {
      d,
      class: `street s-${s || "none"}`,
      fill: "none",
      stroke: "currentColor",
      "stroke-linecap": "round",
      "stroke-width": "4",
      "vector-effect": "non-scaling-stroke",
    }, g);
  });

  overlay = document.createElement("div");
  overlay.className = "pins";
  host.appendChild(overlay);
  labelsEl = document.createElement("div");
  labelsEl.className = "mapLabels";
  overlay.appendChild(labelsEl);
  markers = document.createElement("div");
  markers.className = "markers";
  overlay.appendChild(markers);

  buildSectorLabels();
  bindGestures();
  new ResizeObserver(() => resize()).observe(host);
  resize(true);
}

function buildSectorLabels() {
  labelsEl.innerHTML = SECTEURS.map((s) => {
    const list = streets.filter((r) => r.secteur === s);
    if (!list.length) return "";
    const cx = list.reduce((a, r) => a + r._x, 0) / list.length;
    const cy = list.reduce((a, r) => a + r._y, 0) / list.length;
    return `<span class="sectorLabel s-${s}" data-x="${cx}" data-y="${cy}">${esc(TITRE[s].replace("Secteur ", ""))}</span>`;
  }).join("");
}

/* ───────────── Vue ───────────── */
function fitView(pad = 0.08) {
  const ww = world.maxX - world.minX;
  const wh = world.maxY - world.minY;
  const aspect = size.w / size.h;
  let w = ww * (1 + pad * 2);
  let h = wh * (1 + pad * 2);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  // Léger décalage vers le bas : le compteur occupe le coin supérieur gauche.
  return { x: (world.minX + world.maxX) / 2 - w / 2 - w * 0.03, y: (world.minY + world.maxY) / 2 - h / 2 - h * 0.05, w, h };
}

function resize(first) {
  const r = host.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const prev = { ...size };
  size = { w: r.width, h: r.height };
  if (first || !prev.w || prev.w < 2) {
    view = fitView();
  } else {
    // conserve le centre et l'échelle horizontale
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const scale = view.w / prev.w;
    view = { w: size.w * scale, h: size.h * scale, x: 0, y: 0 };
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
  }
  apply();
}

function clampView(v) {
  const fit = fitView(0.3);
  const minW = 260; // zoom max ≈ 260 m de large
  const w = Math.min(Math.max(v.w, minW), fit.w * 1.4);
  const h = (w * size.h) / size.w;
  const cx = Math.min(Math.max(v.x + v.w / 2, world.minX - 1500), world.maxX + 1500);
  const cy = Math.min(Math.max(v.y + v.h / 2, world.minY - 1500), world.maxY + 1500);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function apply() {
  if (!svg) return;
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  // Densité des points : plus gros quand on zoome
  const mPerPx = view.w / size.w;
  const dot = mPerPx > 22 ? 3 : mPerPx > 10 ? 4 : mPerPx > 4 ? 6 : 8;
  svg.style.setProperty("--dot", dot);
  svg.querySelectorAll(".street").forEach((p) => p.setAttribute("stroke-width", dot));
  placeOverlay();
}

function animateTo(target, dur = 420) {
  cancelAnimationFrame(anim);
  target = clampView(target);
  if (reduceMotion()) {
    view = target;
    apply();
    return;
  }
  const from = { ...view };
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = ease(t);
    view = {
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      w: from.w + (target.w - from.w) * e,
      h: from.h + (target.h - from.h) * e,
    };
    apply();
    if (t < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

export function fit() {
  if (!svg) return;
  animateTo(fitView());
}

/** Cadre la vue sur les dépôts de la tournée (ou toute la ville s'il n'y en a pas). */
export function fitPins() {
  if (!svg) return;
  const pts = pinsData.map((p) => byName.get(p.rue)).filter(Boolean);
  if (!pts.length) return animateTo(fitView());
  const xs = pts.map((r) => r._x);
  const ys = pts.map((r) => r._y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const aspect = size.w / size.h;
  let w = Math.max(Math.max(...xs) - Math.min(...xs), 1600) * 1.5;
  let h = Math.max(Math.max(...ys) - Math.min(...ys), 1600 / aspect) * 1.5;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  animateTo({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/** Centre la carte sur un point (mètres), avec une largeur de vue donnée. */
function flyToWorld(x, y, width = 1600) {
  const w = width;
  const h = (w * size.h) / size.w;
  animateTo({ x: x - w / 2, y: y - h / 2, w, h });
}

/* ───────────── Superposition HTML (balises, mire, étiquettes) ───────────── */
function placeOverlay() {
  if (!overlay) return;
  const zoomed = view.w / size.w < 14;
  labelsEl.querySelectorAll(".sectorLabel").forEach((n) => {
    const [sx, sy] = toScreen(+n.dataset.x, +n.dataset.y);
    n.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    n.classList.toggle("is-faded", zoomed);
  });
  markers.querySelectorAll("[data-wx]").forEach((n) => {
    const [sx, sy] = toScreen(+n.dataset.wx, +n.dataset.wy);
    const off = n.dataset.off ? n.dataset.off.split(",").map(Number) : [0, 0];
    n.style.transform = `translate(${sx + off[0]}px, ${sy + off[1]}px)`;
    const out = sx < -40 || sy < -40 || sx > size.w + 40 || sy > size.h + 60;
    n.style.visibility = out ? "hidden" : "";
  });
}

function renderMarkers() {
  if (!markers) return;
  const html = [];
  if (probePoint) {
    html.push(`<div class="marker probe" data-wx="${probePoint[0]}" data-wy="${probePoint[1]}"><i></i></div>`);
  }
  if (mePoint) {
    html.push(`<div class="marker me" data-wx="${mePoint[0]}" data-wy="${mePoint[1]}"><i class="halo"></i><i class="dot"></i></div>`);
  }
  // Balises des dépôts (décalées en éventail si plusieurs dans la même rue)
  const seen = new Map();
  pinsData.forEach((p, i) => {
    const r = byName.get(p.rue);
    if (!r) return;
    const k = seen.get(p.rue) || 0;
    seen.set(p.rue, k + 1);
    const ang = k * 2.4;
    const rad = k ? 10 + k * 4 : 0;
    const off = `${Math.round(Math.cos(ang) * rad)},${Math.round(Math.sin(ang) * rad)}`;
    const cls = ["pin", i === newPinIndex ? "is-new" : "", i === editingIndex ? "is-editing" : ""].join(" ");
    html.push(
      `<button type="button" class="marker ${cls}" data-i="${i}" data-wx="${r._x}" data-wy="${r._y}" data-off="${off}" tabindex="-1" aria-hidden="true" title="${esc(p.label)}"><svg viewBox="0 0 30 36"><path class="body" d="M15 35s-12-11-12-20a12 12 0 0 1 24 0c0 9-12 20-12 20Z"/></svg><span>${i + 1}</span></button>`,
    );
  });
  if (targetStreet) {
    html.push(
      `<div class="marker target" data-wx="${targetStreet._x}" data-wy="${targetStreet._y}"><i class="ring"></i><i class="ring r2"></i><i class="core"></i><i class="h"></i><i class="v"></i><b class="targetName">${esc(targetStreet.rue)}</b></div>`,
    );
  }
  markers.innerHTML = html.join("");
  markers.querySelectorAll(".pin").forEach((b) => {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.onclick = (e) => {
      e.stopPropagation();
      pinClick(+b.dataset.i);
    };
  });
  newPinIndex = -1;
  placeOverlay();
}

/** Balises des dépôts : [{ rue, label }] dans l'ordre des BP. */
export function setPins(list, { fresh = -1, editing = null } = {}) {
  pinsData = list || [];
  newPinIndex = fresh;
  editingIndex = editing;
  renderMarkers();
}

/** Rue choisie : mire + vol vers elle. */
export function setTarget(name, { fly = true } = {}) {
  targetStreet = name ? byName.get(name) || null : null;
  probePoint = null;
  renderMarkers();
  if (targetStreet && fly) flyToWorld(targetStreet._x, targetStreet._y, 2200);
}

export function setMe(lat, lon, { fly = true } = {}) {
  if (!svg) return;
  mePoint = project(lon, lat);
  renderMarkers();
  if (fly) flyToWorld(mePoint[0], mePoint[1], 1200);
}

/** Estompe les autres secteurs (survol d'un secteur dans le rapport, choix manuel…). */
export function focusSector(s) {
  if (!host) return;
  if (s) host.dataset.focusSector = s;
  else delete host.dataset.focusSector;
}

export function streetByName(name) {
  return byName.get(name) || null;
}

/** Les n rues les plus proches d'un point, avec la distance en mètres. */
export function nearestStreets(lat, lon, n = 5) {
  const [x, y] = project(lon, lat);
  return streets
    .map((r) => ({ r, d: Math.hypot(r._x - x, r._y - y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

export function clearProbe() {
  if (!probePoint) return;
  probePoint = null;
  renderMarkers();
}

/* ───────────── Gestes : glisser, pincer, molette, toucher ───────────── */
function bindGestures() {
  const pts = new Map();
  let start = null;
  let pinch = null;

  host.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    host.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnimationFrame(anim);
    if (pts.size === 1) {
      start = { x: e.clientX, y: e.clientY, t: performance.now(), view: { ...view }, moved: false };
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { ...view }, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (start) start.moved = true;
    }
  });

  host.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = host.getBoundingClientRect();
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k = pinch.d / d;
      const [wx, wy] = [
        pinch.view.x + ((pinch.cx - rect.left) / size.w) * pinch.view.w,
        pinch.view.y + ((pinch.cy - rect.top) / size.h) * pinch.view.h,
      ];
      const w = pinch.view.w * k;
      const h = pinch.view.h * k;
      view = clampView({ x: wx - ((pinch.cx - rect.left) / size.w) * w, y: wy - ((pinch.cy - rect.top) / size.h) * h, w, h });
      apply();
    } else if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) > 6) {
        start.moved = true;
        host.classList.add("is-dragging");
      }
      if (start.moved) {
        view = clampView({
          ...start.view,
          x: start.view.x - (dx / size.w) * start.view.w,
          y: start.view.y - (dy / size.h) * start.view.h,
        });
        apply();
      }
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      host.classList.remove("is-dragging");
      if (start && !start.moved && performance.now() - start.t < 500 && e.type === "pointerup") {
        const rect = host.getBoundingClientRect();
        tap(e.clientX - rect.left, e.clientY - rect.top);
      }
      start = null;
    }
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);

  host.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelAnimationFrame(anim);
      const rect = host.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = toWorld(sx, sy);
      const k = Math.exp(e.deltaY * 0.0015);
      const w = view.w * k;
      const h = view.h * k;
      view = clampView({ x: wx - (sx / size.w) * w, y: wy - (sy / size.h) * h, w, h });
      apply();
    },
    { passive: false },
  );
}

function tap(sx, sy) {
  const [x, y] = toWorld(sx, sy);
  const [lon, lat] = unproject(x, y);
  probePoint = [x, y];
  renderMarkers();
  onPick({ lat, lon, list: nearestStreets(lat, lon, 5) });
}
