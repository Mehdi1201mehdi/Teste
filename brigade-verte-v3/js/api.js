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
