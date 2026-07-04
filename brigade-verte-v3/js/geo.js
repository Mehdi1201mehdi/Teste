// Géolocalisation : propose les rues les plus proches de la position de l'agent.
// L'agent confirme d'un tap — on ne choisit jamais la rue à sa place, car la
// précision GPS en ville peut désigner la rue voisine.

import { $, esc } from "./utils.js";
import { toast } from "./ui.js";
import { getStreets, chooseRue } from "./streets.js";
import { showSuggestions } from "./components.js";
import { COLOR } from "./sectors.js";

/** Distance en mètres entre deux points GPS (formule de haversine). */
function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(d) {
  return d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km";
}

/** Localise l'agent et affiche les 5 rues les plus proches dans les suggestions. */
export async function locateNearestStreets() {
  if (!navigator.geolocation) {
    toast("GPS non disponible sur cet appareil");
    return;
  }
  // Si la localisation a déjà été bloquée pour ce site, le navigateur ne
  // redemandera pas : on l'explique clairement au lieu d'échouer en silence.
  try {
    const status = await navigator.permissions?.query?.({ name: "geolocation" });
    if (status?.state === "denied") {
      toast("Localisation bloquée pour ce site — réactive-la dans les réglages du navigateur (icône 🔒 à côté de l'adresse)");
      return;
    }
  } catch (e) {
    /* API permissions absente (vieux Safari) : on tente directement */
  }
  toast("📡 Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const streets = getStreets().filter((r) => r.lat && r.lon);
      if (!streets.length) {
        toast("Liste des rues indisponible");
        return;
      }
      const nearest = streets
        .map((r) => ({ r, d: distMeters(latitude, longitude, r.lat, r.lon) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5);
      const entries = nearest.map(({ r, d }) => ({
        html: `<span class="sugName">${esc(r.rue)}</span><span class="pill" style="background:${COLOR[r.secteur] || "#64748b"}">${fmtDist(d)}</span>`,
        onClick: () => chooseRue(r),
      }));
      showSuggestions($("streetSuggest"), entries, "Aucune rue trouvée près d'ici.");
      $("streetInput").setAttribute("aria-expanded", "true");
      toast("Touche ta rue 👇");
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        toast("GPS refusé — autorise la localisation dans les réglages du téléphone");
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        toast("Position introuvable — réessaie à l'extérieur");
      } else {
        toast("GPS trop lent — réessaie");
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
}
