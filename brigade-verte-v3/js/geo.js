// Géolocalisation : position de l'agent → rues les plus proches.
// On ne choisit jamais la rue à sa place : en ville, le GPS peut désigner la
// rue voisine. L'agent confirme d'un toucher.

/** Distance lisible : « 40 m », « 1,2 km ». */
export function fmtDist(d) {
  return d < 1000 ? Math.round(d / 5) * 5 + " m" : (d / 1000).toFixed(1).replace(".", ",") + " km";
}

/**
 * Demande la position. Résout { lat, lon, accuracy } ou rejette avec un
 * message déjà rédigé pour l'agent.
 */
export async function locate() {
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
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("GPS refusé — autorisez la localisation dans les réglages du téléphone."));
        else if (err.code === err.POSITION_UNAVAILABLE) reject(new Error("Position introuvable — réessayez à découvert."));
        else reject(new Error("GPS trop lent — réessayez."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}
