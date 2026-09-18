// Petites fonctions pures partagées par tous les modules.

export const $ = (id) => document.getElementById(id);

/** Normalise une chaîne pour la recherche : minuscules, sans accents, sans ponctuation. */
export function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Échappe le HTML pour un affichage sûr dans innerHTML. */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function nowHM() {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Date du jour au format AAAA-MM-JJ en heure LOCALE (évite le décalage UTC le soir). */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Détecte la plateforme pour adapter l'ouverture du message : sur mobile
 * (iPhone, Android — quelle que soit la marque), on tente l'appli Outlook
 * via son lien direct ; sur PC (Windows, Mac, Linux), on passe directement
 * par l'appli mail par défaut du système, plus fiable qu'un lien d'appli
 * qui n'existe pas sur ces plateformes.
 */
export function detectPlatform() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}
