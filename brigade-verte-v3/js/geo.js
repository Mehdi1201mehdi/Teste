// Géolocalisation de l'agent : une mesure FRAÎCHE, affinée quelques secondes,
// puis le GPS est coupé (aucun suivi permanent : batterie et vie privée).
//
// · maximumAge: 0 — jamais une position gardée en cache par le navigateur ;
//   une mesure horodatée d'avant la demande est ignorée.
// · enableHighAccuracy: true — puce GPS (et pas seulement Wi-Fi / antennes).
// · La précision affichée est celle du capteur, jamais inventée.

import { detectPlatform } from "./utils.js";
import { MAX_USABLE_ACCURACY, CONFIDENT_ACCURACY } from "./streetgeo.js";

/** Distance lisible : « 40 m », « 1,2 km ». */
export function fmtDist(d) {
  if (d < 10) return Math.max(1, Math.round(d)) + " m";
  return d < 1000 ? Math.round(d / 5) * 5 + " m" : (d / 1000).toFixed(1).replace(".", ",") + " km";
}

/** Qualité lisible d'une précision GPS (rayon en mètres). */
export function gpsQuality(acc) {
  if (acc <= 20) return "good";
  if (acc <= MAX_USABLE_ACCURACY) return "fair";
  return "poor";
}

/**
 * Validation de la précision : `usable` — assez précise pour proposer une
 * rue ; `confident` — assez précise pour retenir une rue isolée d'office.
 */
export function validatePositionAccuracy(acc) {
  const a = Number(acc);
  if (!Number.isFinite(a) || a <= 0) return { quality: "poor", usable: false, confident: false };
  return { quality: gpsQuality(a), usable: a <= MAX_USABLE_ACCURACY, confident: a <= CONFIDENT_ACCURACY };
}

/** Erreur de localisation lisible par un agent : `code` + `hint` (réglages). */
export class LocationError extends Error {
  constructor(code, message, hint = "") {
    super(message);
    this.code = code; // insecure | unsupported | denied | blocked | unavailable | timeout
    this.hint = hint;
  }
}

function settingsHint() {
  const p = detectPlatform();
  if (p === "ios") return "iPhone : Réglages › Confidentialité et sécurité › Service de localisation : activé, puis Safari (ou Chrome) › « Lorsque l'app est active ». Rechargez ensuite la page.";
  if (p === "android") return "Android : touchez l'icône à gauche de l'adresse du site › Autorisations › Position › Autoriser. Vérifiez aussi que la Localisation du téléphone est activée.";
  return "Ordinateur : cliquez sur l'icône à gauche de l'adresse du site › Localisation › Autoriser, puis réessayez.";
}

function fromGeoError(err) {
  if (err?.code === 1) return new LocationError("denied", "L'accès à votre position est refusé. Autorisez la localisation dans les réglages du navigateur puis réessayez.", settingsHint());
  if (err?.code === 2)
    return new LocationError(
      "unavailable",
      "Position indisponible. Vérifiez que la localisation (GPS) du téléphone est activée, puis réessayez à découvert.",
      detectPlatform() === "ios" ? "iPhone : Réglages › Confidentialité et sécurité › Service de localisation." : "Android : faites glisser le haut de l'écran et activez « Localisation ».",
    );
  return new LocationError("timeout", "Le GPS ne répond pas assez vite. Réessayez dans un endroit dégagé, ou choisissez la rue dans la liste.");
}

/** Contrôles préalables : contexte sécurisé, API présente, blocage connu. */
export async function checkLocationAvailable() {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new LocationError("insecure", "La localisation exige une connexion sécurisée (https). Ouvrez l'application depuis son adresse officielle.");
  }
  if (!("geolocation" in navigator) || !navigator.geolocation?.watchPosition) {
    throw new LocationError("unsupported", "Ce navigateur ne permet pas la localisation. Choisissez la rue dans la liste ou touchez la carte.");
  }
  try {
    const status = await navigator.permissions?.query?.({ name: "geolocation" });
    if (status?.state === "denied") {
      // Refus mémorisé : le navigateur ne redemandera pas tout seul.
      throw new LocationError("blocked", "La localisation est bloquée pour ce site. Autorisez-la dans les réglages du navigateur puis réessayez.", settingsHint());
    }
  } catch (e) {
    if (e instanceof LocationError) throw e;
    /* API Permissions absente (anciens Safari) : on tente directement */
  }
}

/**
 * Position actuelle : premier point dès qu'il arrive (onFix), puis affinage
 * jusqu'à `goal` mètres ou `maxMs`. Résout avec la meilleure mesure reçue
 * (`{lat, lon, accuracy, timestamp}`), le GPS étant alors arrêté.
 * `signal` (AbortSignal) permet d'annuler.
 */
export async function getCurrentPosition({ onFix, goal = 15, maxMs = 12000, signal } = {}) {
  await checkLocationAvailable();
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let best = null;
    let done = false;
    let id = null;
    const finish = (err) => {
      if (done) return;
      done = true;
      if (id != null) navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err && (err.code === "denied" || err.code === "aborted" || !best)) reject(err);
      else if (best) resolve(best);
      else reject(fromGeoError({ code: 3 }));
    };
    const onAbort = () => finish(new LocationError("aborted", "Localisation annulée."));
    signal?.addEventListener("abort", onAbort);
    id = navigator.geolocation.watchPosition(
      (pos) => {
        // Mesure antérieure à la demande (cache du système) : ignorée.
        // Tolérance de 30 s : certaines puces horodatent avec l'heure GPS.
        if (pos.timestamp && pos.timestamp < startedAt - 30000) return;
        const fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Math.max(1, Math.round(pos.coords.accuracy)),
          timestamp: pos.timestamp || Date.now(),
        };
        if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
        if (best && fix.accuracy >= best.accuracy) return;
        best = fix;
        onFix?.(fix);
        if (fix.accuracy <= goal) finish();
      },
      (err) => {
        // Refus : tout s'arrête. Autre erreur : on garde la meilleure mesure.
        if (err.code === 1 || !best) finish(fromGeoError(err));
      },
      { enableHighAccuracy: true, timeout: maxMs, maximumAge: 0 },
    );
    const timer = setTimeout(() => finish(), maxMs);
  });
}
