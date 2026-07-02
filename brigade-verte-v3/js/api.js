// Accès réseau : mêmes API que l'outil existant, jamais remplacées.
// Toute panne réseau est absorbée ici : l'appelant reçoit simplement `null`
// et retombe sur le secteur embarqué dans data/streets.json (mode terrain / hors ligne).

const WFS = "https://geodata.amiens-metropole.com/wfs";
const ADRESSE_API = "https://api-adresse.data.gouv.fr/search/";
const AMIENS_CITYCODE = "80021";

/** Récupère les contours géographiques des secteurs (GeoJSON) depuis le WFS Amiens Métropole. */
export async function fetchSectorContours() {
  try {
    const url =
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=secteur-ville&outputFormat=application/json&srsName=EPSG:4326`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return j.features ? j : null;
  } catch (e) {
    return null;
  }
}

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
