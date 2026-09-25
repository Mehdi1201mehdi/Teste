// Position → rue : calculs purs (aucun DOM, aucun réseau), partagés par
// l'application et par l'outil qui génère data/streets-geo.json.
//
// Principe : la distance est mesurée jusqu'au TRACÉ RÉEL de chaque rue
// (tronçons IGN BD TOPO), pas jusqu'à un point central. Une longue avenue dont
// le centre est à 600 m peut donc être la rue où se trouve l'agent — c'était
// l'erreur de l'ancienne méthode (un seul point par rue).
//
// La décision (decideStreet) ne prétend jamais à une certitude que la
// précision GPS ne permet pas : sinon, elle demande une confirmation.

/** Nom comparable : sans accents, casse, apostrophes ni tirets. */
export function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Projection locale équirectangulaire autour d'Amiens : erreur < 0,1 % sur
// quelques kilomètres, largement sous la précision d'un GPS.
const LAT0 = 49.894;
const KY = 111_320;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/** Décode une ligne delta-encodée (entiers 1e-5 degré) en [x, y] mètres. */
function decodeLine(enc) {
  const out = new Float64Array(enc.length);
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < enc.length; i += 2) {
    lon += enc[i];
    lat += enc[i + 1];
    out[i] = (lon / 1e5) * KX;
    out[i + 1] = (lat / 1e5) * KY;
  }
  return out;
}

/** Distance (m) d'un point au segment [a, b], coordonnées projetées. */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/**
 * Index des rues de l'application.
 * @param {Array<{rue,lat,lon,secteur}>} streets  data/streets.json
 * @param {{s:Object<string, number[][]>}|null} geo  data/streets-geo.json (facultatif)
 */
export function createStreetIndex(streets, geo = null) {
  const entries = streets.map((r) => {
    const lines = (geo?.s?.[r.rue] || []).map(decodeLine);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const l of lines) {
      for (let i = 0; i < l.length; i += 2) {
        if (l[i] < minX) minX = l[i];
        if (l[i] > maxX) maxX = l[i];
        if (l[i + 1] < minY) minY = l[i + 1];
        if (l[i + 1] > maxY) maxY = l[i + 1];
      }
    }
    return { r, lines, bbox: lines.length ? [minX, minY, maxX, maxY] : null, px: r.lon * KX, py: r.lat * KY };
  });
  const byNorm = new Map(streets.map((r) => [normName(r.rue), r]));
  const withLines = entries.filter((e) => e.lines.length).length;

  function distanceTo(e, x, y, bound) {
    // Pas de tracé (cours, esplanades…) : distance au point de référence.
    if (!e.lines.length) return { d: Math.hypot(e.px - x, e.py - y), exact: false };
    const [x0, y0, x1, y1] = e.bbox;
    const bx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const by = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    if (Math.hypot(bx, by) > bound) return null; // trop loin : inutile de détailler
    let best = Infinity;
    for (const l of e.lines) {
      for (let i = 0; i + 3 < l.length; i += 2) {
        const d = distSeg(x, y, l[i], l[i + 1], l[i + 2], l[i + 3]);
        if (d < best) best = d;
      }
    }
    return { d: best, exact: true };
  }

  return {
    /** Part des rues dont le tracé réel est connu (0–1). */
    coverage: streets.length ? withLines / streets.length : 0,
    hasGeometry: withLines > 0,
    byNorm,
    /**
     * Les n rues les plus proches d'un point [lat, lon] avec leur distance
     * en mètres. `exact` : distance au tracé réel (true) ou au point de
     * référence de la rue (false, moins fiable).
     */
    nearest(lat, lon, n = 5) {
      const x = lon * KX;
      const y = lat * KY;
      const out = [];
      const bound = 2500;
      for (const e of entries) {
        const res = distanceTo(e, x, y, bound);
        if (!res) continue;
        out.push({ r: e.r, d: res.d, exact: res.exact });
      }
      out.sort((a, b) => a.d - b.d);
      return out.slice(0, n);
    },
    /** Rue de l'application correspondant à un nom venu d'ailleurs (BAN…). */
    match(name) {
      return byNorm.get(normName(name)) || null;
    },
  };
}

/** Précision au-delà de laquelle aucune rue n'est proposée comme détectée. */
export const MAX_USABLE_ACCURACY = 50;
/** Précision en deçà de laquelle une rue isolée peut être retenue d'office. */
export const CONFIDENT_ACCURACY = 30;

/**
 * Choix de la rue à partir de la mesure GPS, des rues les plus proches (tracé
 * réel) et, si disponible, de l'adresse renvoyée par le géocodage inverse.
 *
 * Renvoie :
 *  · status "confident"  — une seule rue compatible avec la précision : elle
 *    peut être retenue (l'agent peut toujours la changer) ;
 *  · status "ambiguous"  — plusieurs rues possibles : confirmation requise ;
 *  · status "imprecise"  — précision insuffisante : aucune rue n'est affirmée.
 *
 * @param {{accuracy:number}} fix
 * @param {Array<{r, d:number, exact:boolean}>} near  triées par distance
 * @param {{street:object|null, housenumber:string, distance:number}|null} rev
 */
export function decideStreet(fix, near, rev = null) {
  const acc = Math.max(1, Number(fix?.accuracy) || 999);
  const list = (near || []).slice();
  const reasons = [];

  // Le géocodage inverse désigne une rue proche absente du top : on l'ajoute.
  if (rev?.street && !list.some((c) => c.r.rue === rev.street.rue)) {
    list.push({ r: rev.street, d: rev.distance ?? acc, exact: false, fromReverse: true });
  }
  const top = list[0] || null;
  const second = list[1] || null;

  if (!top) return { status: "imprecise", accuracy: acc, street: null, candidates: [], numero: "", reasons: ["no-street"] };

  // Rues compatibles avec la mesure : celles dont le tracé passe dans le
  // cercle d'incertitude (tolérance : largeur de chaussée + trottoirs).
  const reach = acc + 12;
  const compatible = list.filter((c) => c.d <= Math.max(reach, top.d + 6));

  if (acc > MAX_USABLE_ACCURACY) {
    reasons.push("accuracy");
    return { status: "imprecise", accuracy: acc, street: null, candidates: list.slice(0, 5), numero: "", reasons };
  }
  if (top.d > reach + 25) {
    // Aucune rue connue à proximité (parc, voie privée, hors Amiens…).
    reasons.push("far");
    return { status: "ambiguous", accuracy: acc, street: null, candidates: list.slice(0, 5), numero: "", reasons };
  }

  // L'adresse officielle ne contredit le tracé que si elle est proche de la
  // mesure ET que sa rue passe dans le cercle d'incertitude. Cas réel : à 6 m
  // de la rue Lemerchier, le numéro le plus proche (43 m) est au boulevard
  // Jules Verne, sur l'immeuble d'angle — ce n'est pas une raison de douter.
  const revCand = rev?.street ? list.find((c) => c.r.rue === rev.street.rue) : null;
  const revRelevant = !!rev?.street && (rev.distance ?? 999) <= Math.max(25, acc + 15) && (!revCand?.exact || revCand.d <= reach);
  const revAgrees = !revRelevant || rev.street.rue === top.r.rue;
  const margin = second ? second.d - top.d : Infinity;
  const clearWinner = compatible.length === 1 || margin >= Math.max(10, acc * 0.6);

  let status = "ambiguous";
  if (acc <= CONFIDENT_ACCURACY && top.exact && clearWinner && revAgrees && top.d <= reach) status = "confident";
  if (!top.exact) reasons.push("no-geometry");
  if (!clearWinner) reasons.push("close-streets");
  if (!revAgrees) reasons.push("reverse-disagrees");
  if (acc > CONFIDENT_ACCURACY) reasons.push("accuracy");

  // Candidates : la rue du géocodage inverse remonte juste après la plus proche.
  let candidates = list.slice(0, 5);
  if (rev?.street && !revAgrees) {
    candidates = [top, ...list.filter((c) => c.r.rue === rev.street.rue), ...list.filter((c) => c !== top && c.r.rue !== rev.street.rue)].slice(0, 5);
  }

  // Numéro : seulement celui de la rue retenue, et proche de la mesure.
  const numero =
    rev?.housenumber && rev.street && rev.street.rue === top.r.rue && (rev.distance ?? 999) <= Math.max(20, acc) ? String(rev.housenumber) : "";

  return { status, accuracy: acc, street: top.r, candidates, numero, reasons };
}

/**
 * Lecture du géocodage inverse (Géoplateforme / BAN, format GeoJSON) :
 * on ne prend PAS le premier résultat au hasard — on retient le numéro le plus
 * proche dont la rue existe dans l'application ; à défaut, la voie la plus proche.
 */
export function readReverse(features, index) {
  const rows = (features || [])
    .map((f) => {
      const p = f.properties || {};
      const name = p.street || (p.type === "street" ? p.name : "") || "";
      return { type: p.type, name, housenumber: p.housenumber || "", distance: Number(p.distance), city: p.city || "", postcode: p.postcode || "" };
    })
    .filter((x) => x.name && Number.isFinite(x.distance))
    .sort((a, b) => a.distance - b.distance);
  const known = rows.map((x) => ({ ...x, street: index.match(x.name) })).filter((x) => x.street);
  const hn = known.find((x) => x.type === "housenumber");
  const best = hn || known[0];
  if (!best) return rows.length ? { street: null, housenumber: "", distance: rows[0].distance, label: rows[0].name, city: rows[0].city } : null;
  return { street: best.street, housenumber: best.housenumber, distance: best.distance, label: best.name, city: best.city, postcode: best.postcode };
}
