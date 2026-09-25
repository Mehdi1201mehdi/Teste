// Accès réseau : Base Adresse Nationale (géocodage du numéro).
// Les contours de secteurs et de quartiers sont embarqués (data/*.geojson),
// issus du service WFS d'Amiens Métropole — plus aucun appel WFS à l'exécution.
// Toute panne réseau est absorbée ici : l'appelant reçoit simplement `null`.

const ADRESSE_API = "https://api-adresse.data.gouv.fr/search/";
const AMIENS_CITYCODE = "80021";

/** Géocode "numéro + rue" à Amiens et renvoie [lon, lat], ou null si indisponible. */
export async function geocodeAddress(numero, rue) {
  try {
    const q = `${numero} ${rue} Amiens`;
    const url = `${ADRESSE_API}?q=${encodeURIComponent(q)}&citycode=${AMIENS_CITYCODE}&limit=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const f = (j.features || [])[0];
    if (f && f.geometry) return f.geometry.coordinates;
    return null;
  } catch (e) {
    return null;
  }
}

/* ─── Géocodage inverse : coordonnées → adresse la plus proche ───
   Service officiel de la Géoplateforme IGN (successeur de api-adresse), avec
   repli sur api-adresse.data.gouv.fr. Public, sans clé, CORS ouvert ; limite
   d'usage raisonnable (≈ 50 requêtes/s/IP) très au-delà d'un usage terrain.
   Une seule requête par mesure GPS ; résultats gardés en mémoire (≈ 10 m). */
const REVERSE_APIS = [
  (lat, lon) => `https://data.geopf.fr/geocodage/reverse?lon=${lon}&lat=${lat}&index=address&limit=10`,
  (lat, lon) => `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=10`,
];
const reverseCache = new Map();

/** Erreur typée : `kind` = "offline" | "unavailable". */
export class ReverseError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Adresses proches d'un point (GeoJSON `features`, chacune avec `distance` en
 * mètres). Lève ReverseError si hors connexion ou si aucun service ne répond.
 */
export async function reverseGeocode(lat, lon, { timeoutMs = 4500 } = {}) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ReverseError("offline", "Hors connexion");
  }
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  let lastErr = null;
  for (const url of REVERSE_APIS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url(la, lo), { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const features = Array.isArray(j.features) ? j.features : [];
      reverseCache.set(key, features);
      if (reverseCache.size > 50) reverseCache.delete(reverseCache.keys().next().value);
      return features;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  throw new ReverseError(offline ? "offline" : "unavailable", lastErr?.message || "Service indisponible");
}
