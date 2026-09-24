// Géolocalisation : position de l'agent → rues les plus proches.
// On ne choisit jamais la rue à sa place : en ville, le GPS peut désigner la
// rue voisine. L'agent confirme d'un toucher.

/** Distance lisible : « 40 m », « 1,2 km ». */
export function fmtDist(d) {
  return d < 1000 ? Math.round(d / 5) * 5 + " m" : (d / 1000).toFixed(1).replace(".", ",") + " km";
}

/** Qualité lisible d'une précision GPS (rayon en mètres). */
export function gpsQuality(acc) {
  if (acc <= 20) return "good";
  if (acc <= 60) return "fair";
  return "poor";
}

/** Vérifie que la localisation est possible ; lève un message rédigé sinon. */
async function checkPermission() {
  if (!navigator.geolocation) throw new Error("GPS non disponible sur cet appareil.");
  try {
    const status = await navigator.permissions?.query?.({ name: "geolocation" });
    if (status?.state === "denied") {
      throw new Error("Localisation bloquée pour ce site — réactivez-la via le cadenas à côté de l'adresse.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Localisation")) throw e;
    /* API permissions absente (ancien Safari) : on tente directement */
  }
}

function gpsError(err) {
  if (err.code === err.PERMISSION_DENIED) return new Error("GPS refusé — autorisez la localisation dans les réglages du téléphone.");
  if (err.code === err.POSITION_UNAVAILABLE) return new Error("Position introuvable — réessayez à découvert, loin des façades hautes.");
  return new Error("GPS trop lent — réessayez, ou touchez la carte à l'endroit du dépôt.");
}

/**
 * Suit la position le temps qu'elle s'affine : le premier point arrive vite
 * (souvent ± 50–150 m), les suivants resserrent le cercle. S'arrête dès que la
 * précision atteint `goal` mètres, ou après `maxMs`, et résout avec la MEILLEURE
 * mesure reçue. `onFix` est appelé à chaque amélioration (vraies valeurs du
 * capteur — on n'invente jamais une précision).
 */
export async function trackLocate({ onFix, goal = 25, maxMs = 12000 } = {}) {
  await checkPermission();
  return new Promise((resolve, reject) => {
    let best = null;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(err || new Error("GPS trop lent — réessayez, ou touchez la carte à l'endroit du dépôt."));
    };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        if (best && fix.accuracy >= best.accuracy) return;
        best = fix;
        onFix?.(fix);
        if (fix.accuracy <= goal) finish();
      },
      (err) => {
        // Refus : on arrête tout. Autres erreurs : on garde la meilleure mesure.
        if (err.code === err.PERMISSION_DENIED || !best) finish(gpsError(err));
      },
      { enableHighAccuracy: true, timeout: maxMs, maximumAge: 5000 },
    );
    const timer = setTimeout(() => finish(), maxMs);
  });
}
