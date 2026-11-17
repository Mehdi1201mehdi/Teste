// Envoi du rapport : préparation du message et ouverture de la messagerie.
// L'application PRÉPARE le message ; l'agent l'envoie lui-même (jamais d'envoi
// automatique). Aucune plateforme ne garantit l'ouverture d'une appli tierce :
// chaque tentative a donc un repli visible (Outlook Web, autre messagerie,
// copie du message).
//
// Mise en forme : un lien (mailto:, ms-outlook:, Outlook Web) ne transporte
// QUE du texte brut : les titres de secteur y sont écrits en lettres grasses
// Unicode (voir boldText). La version mise en forme (HTML, secteurs en gras)
// passe aussi par le presse-papiers, collée telle quelle par Outlook, Gmail…

import { detectPlatform, esc as escHtml } from "./utils.js";

/* ─── Contenu ─── */

// Titre de secteur, seul sur sa ligne : « Secteur Centre : ».
const SECTOR_LINE = /^(\s*)(Secteur (?:Centre|Ouest|Nord|Est|Sud))(\s*:?\s*)$/i;

/** Destinataires valides d'une saisie libre (séparés par virgule, point-virgule ou espace). */
export function parseRecipients(input) {
  const list = String(input || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = list.filter((a) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(a));
  return { valid, invalid: list.filter((a) => !valid.includes(a)) };
}

/**
 * Corps du message à partir du texte du rapport.
 *  · html  : secteurs en <b>…</b>, retours à la ligne conservés ;
 *  · plain : secteurs en gras Unicode (texte brut des liens) ;
 *  · previewHtml : aperçu dans l'application (même mise en forme que html).
 */
/**
 * Gras en texte brut : lettres « grasses » Unicode (sans empattement).
 * Un lien mailto:/Outlook ne transporte pas de mise en forme ; ces caractères
 * s'affichent pourtant en gras dans Outlook, Gmail, Apple Mail… Les titres de
 * secteur n'ont ni accent ni chiffre (Secteur Centre/Ouest/Nord/Est/Sud) :
 * toutes leurs lettres existent en gras Unicode.
 */
export function boldText(s) {
  return String(s).replace(/[A-Za-z]/g, (c) => {
    const code = c.charCodeAt(0);
    return String.fromCodePoint(code <= 90 ? 0x1d5d4 + code - 65 : 0x1d5ee + code - 97);
  });
}

export function buildEmailBody(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const plain = lines.map((l) => l.replace(SECTOR_LINE, (_, a, t, b) => a + boldText(t) + b)).join("\n");
  // Variante compacte (secteurs en MAJUSCULES) : un caractère gras Unicode pèse
  // 12 caractères dans un lien ; utilisée si le lien gras dépasse la limite.
  const plainCompact = lines.map((l) => l.replace(SECTOR_LINE, (_, a, t, b) => a + t.toUpperCase() + b)).join("\n");
  const htmlLines = lines.map((l) => {
    const m = l.match(SECTOR_LINE);
    const lead = (s) => escHtml(s).replace(/^ +/, (sp) => "&nbsp;".repeat(sp.length));
    return m ? `${lead(m[1])}<b>${escHtml(m[2])}</b>${escHtml(m[3])}` : lead(l);
  });
  const html =
    '<div style="font-family:Calibri,Aptos,Arial,sans-serif;font-size:11pt;line-height:1.4;color:#111">' + htmlLines.join("<br>\n") + "</div>";
  const previewHtml = lines
    .map((l) => {
      const m = l.match(SECTOR_LINE);
      return m ? `${escHtml(m[1])}<b class="mailSector">${escHtml(m[2])}</b>${escHtml(m[3])}` : escHtml(l);
    })
    .join("\n");
  return { plain, plainCompact, html, previewHtml };
}

/* ─── Liens ─── */

const enc = encodeURIComponent;

/** Paramètres de requête encodés (RFC 6068 : espaces en %20, jamais « + »). */
function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${enc(v)}`)
    .join("&");
}

/** mailto:a@b.fr,c@d.fr?subject=…&body=… (retours à la ligne en %0D%0A). */
export function mailtoUrl({ to = [], subject = "", body = "" }) {
  const crlf = body.replace(/\r?\n/g, "\r\n");
  return `mailto:${to.map((a) => enc(a).replace(/%40/g, "@")).join(",")}?${query({ subject, body: crlf })}`;
}

/** Appli Outlook (iOS / Android) : ms-outlook://compose?to=…&subject=…&body=… */
export function outlookAppUrl({ to = [], subject = "", body = "" }) {
  return `ms-outlook://compose?${query({ to: to.join(","), subject, body })}`;
}

/** Outlook sur le web (comptes professionnels Microsoft 365). */
export function outlookWebUrl({ to = [], subject = "", body = "" }) {
  return `https://outlook.office.com/mail/deeplink/compose?${query({ to: to.join(","), subject, body })}`;
}

/**
 * Android : ouvre DIRECTEMENT l'appli Outlook, déjà remplie.
 * Lien de messagerie standard (mailto:) adressé à l'appli Outlook seule, avec
 * l'action VIEW — celle des liens e-mail ordinaires. Chrome n'ouvre depuis un
 * site que les applis qui acceptent les liens web (catégorie BROWSABLE) ;
 * c'est le cas d'Outlook pour VIEW + mailto (pas pour SENDTO, ni pour
 * « ms-outlook://compose », prévu pour iPhone).
 * Échec (Outlook absent ou refus) : le navigateur revient sur l'application
 * (`returnUrl`), qui propose alors la messagerie du téléphone et retient de
 * l'utiliser directement les fois suivantes.
 * Forme : intent:dest?subject=…&body=…#Intent;action=VIEW;scheme=mailto;…
 * (Android reconstitue « mailto:dest?subject=… »).
 */
export function androidIntentUrl(msg, returnUrl = "") {
  const to = (msg.to || []).map((a) => enc(a).replace(/%40/g, "@")).join(",");
  const q = query({ subject: msg.subject, body: String(msg.body || "").replace(/\r?\n/g, "\r\n") });
  const fallback = returnUrl || outlookWebUrl(msg);
  return (
    `intent:${to}?${q}#Intent;action=android.intent.action.VIEW;scheme=mailto;` +
    `package=com.microsoft.office.outlook;S.browser_fallback_url=${enc(fallback)};end`
  );
}

/* Android : mémorise qu'Outlook ne s'ouvre pas directement sur cet appareil. */
const ANDROID_MAIL_KEY = "bv_android_mail";
export const ANDROID_RETURN_PARAM = "outlook";
export function androidUsesMailto() {
  try {
    return localStorage.getItem(ANDROID_MAIL_KEY) === "mailto";
  } catch (e) {
    return false;
  }
}
export function rememberAndroidMailto() {
  try {
    localStorage.setItem(ANDROID_MAIL_KEY, "mailto");
  } catch (e) {
    /* stockage indisponible : on réessaiera l'appli la prochaine fois */
  }
}
/** Adresse de retour dans l'application si Outlook ne s'ouvre pas (Android). */
export function androidReturnUrl() {
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return "";
  return `${location.origin}${location.pathname}?${ANDROID_RETURN_PARAM}=echec#rapport`;
}

// Longueur maximale d'un lien par canal (au-delà : corps collé depuis le
// presse-papiers). Valeurs prudentes : Outlook classique tronque les mailto
// longs ; les serveurs web refusent les URL de plus de ~8 Ko.
export const URL_LIMITS = { mailto: 1900, web: 7000, app: 16000, intent: 16000 };

/* ─── Plateforme ─── */

/**
 * Plateforme d'après les capacités, puis l'identifiant du navigateur quand
 * aucune capacité ne suffit (le choix du lien d'appli en dépend : aucune API
 * web ne dit si Outlook est installé).
 */
export function emailPlatform() {
  const uaMobile = navigator.userAgentData?.mobile;
  const p = detectPlatform();
  if (p === "ios") return "ios";
  if (p === "android" || uaMobile === true) return "android";
  return "desktop";
}

/**
 * Choix du lien pour un canal : "app" (Outlook appli / messagerie du PC),
 * "web" (Outlook Web) ou "mailto" (messagerie par défaut du téléphone).
 * Renvoie { url, kind, truncated } — `truncated` : corps trop long pour un
 * lien, remplacé par une invite à coller le message copié.
 */
export function planEmail(channel, msg, platform = emailPlatform()) {
  let kind;
  if (channel === "web") kind = "web";
  else if (channel === "mailto") kind = "mailto";
  else if (platform === "ios") kind = "app";
  // Android : appli Outlook directement, sauf si l'appareil a déjà montré
  // qu'elle ne s'ouvre pas ainsi — alors la messagerie du téléphone (mailto).
  else if (platform === "android") kind = androidUsesMailto() ? "mailto" : "intent";
  else kind = "mailto";

  const returnUrl = kind === "intent" ? androidReturnUrl() : "";
  const build = { web: outlookWebUrl, mailto: mailtoUrl, app: outlookAppUrl, intent: (m) => androidIntentUrl(m, returnUrl) }[kind];
  let url = build(msg);
  let truncated = false;
  // Messageries mobiles : liens longs acceptés ; Outlook classique sur PC : non.
  const limit = kind === "mailto" && platform !== "desktop" ? URL_LIMITS.app : URL_LIMITS[kind];
  // Trop long avec les secteurs en gras : on essaie d'abord en MAJUSCULES.
  if (url.length > limit && msg.bodyCompact) url = build({ ...msg, body: msg.bodyCompact });
  if (url.length > limit) {
    truncated = true;
    url = build({ ...msg, body: "(Message trop long pour un lien : collez ici le rapport copié par l'application.)\n" });
  }
  return { url, kind, truncated };
}

/* ─── Presse-papiers ─── */

/**
 * Copie le message : HTML (secteurs en gras souligné) + texte brut.
 * Renvoie "rich" | "plain" | false. À appeler pendant le geste de l'agent
 * (Safari refuse la copie après un délai).
 */
export async function copyEmailContent({ html, text }) {
  // 1. API moderne : HTML + texte (Chrome, Edge, Safari 13.1+, Firefox 127+).
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return "rich";
    }
  } catch (e) {
    /* refus ou format non pris en charge : méthode suivante */
  }
  // 2. Ancienne méthode, encore la plus compatible, et elle aussi en HTML.
  if (legacyCopy(html, text)) return "rich";
  // 3. Texte seul.
  try {
    await navigator.clipboard.writeText(text);
    return "plain";
  } catch (e) {
    return false;
  }
}

function legacyCopy(html, text) {
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;white-space:pre-wrap";
  box.innerHTML = html;
  document.body.appendChild(box);
  const sel = window.getSelection();
  const saved = sel.rangeCount ? sel.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(box);
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  const onCopy = (e) => {
    // Force les deux formats (certains navigateurs n'en gardent qu'un).
    e.clipboardData?.setData("text/html", html);
    e.clipboardData?.setData("text/plain", text);
    if (e.clipboardData) e.preventDefault();
  };
  document.addEventListener("copy", onCopy, { once: true });
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  document.removeEventListener("copy", onCopy);
  sel.removeAllRanges();
  if (saved) sel.addRange(saved);
  box.remove();
  return ok;
}

/* ─── Ouverture ─── */

/**
 * Ouvre la messagerie avec destinataire, objet et corps préremplis.
 * Ne fait JAMAIS l'envoi. `onNotOpened` est appelé si, après `waitMs`, la
 * page est toujours au premier plan (appli absente, lien bloqué par un
 * navigateur intégré…) : l'interface propose alors les replis.
 * Renvoie le plan utilisé ({ url, kind, truncated }).
 */
export function openEmailClient(channel, msg, { onNotOpened, waitMs = 2200, platform = emailPlatform(), navigate } = {}) {
  const plan = planEmail(channel, msg, platform);
  // window.__bvNavigate : point d'observation pour les tests automatisés (un
  // navigateur de test ne peut pas ouvrir ms-outlook:// ni mailto:). Absent en usage réel.
  const go = navigate || window.__bvNavigate || ((url) => (window.location.href = url));

  if (plan.kind === "web") {
    // Nouvel onglet (la tournée reste ouverte) ; bloqué → même onglet.
    if (window.__bvNavigate) {
      window.__bvNavigate(plan.url);
      return plan;
    }
    // Pas de « noopener » dans les options : window.open renverrait alors
    // toujours null (norme HTML) et l'on ne saurait pas si l'onglet est bloqué.
    const w = window.open(plan.url, "_blank");
    if (w) {
      try {
        w.opener = null; // l'onglet Outlook ne peut pas agir sur l'application
      } catch (e) {
        /* propriété en lecture seule sur certains navigateurs : sans conséquence */
      }
    } else go(plan.url); // fenêtre bloquée (appli installée, navigateur intégré…)
    return plan;
  }

  if (onNotOpened) {
    let left = false;
    const markLeft = () => {
      if (document.visibilityState === "hidden") left = true;
    };
    const onBlur = () => (left = true);
    document.addEventListener("visibilitychange", markLeft);
    window.addEventListener("pagehide", onBlur);
    // Ordinateur : la page reste visible quand Outlook s'ouvre, mais elle perd
    // le focus — sans cela, le repli « ne s'est pas ouvert » s'afficherait à tort.
    window.addEventListener("blur", onBlur);
    setTimeout(() => {
      document.removeEventListener("visibilitychange", markLeft);
      window.removeEventListener("pagehide", onBlur);
      window.removeEventListener("blur", onBlur);
      if (!left && document.visibilityState === "visible") onNotOpened(plan);
    }, waitMs);
  }
  go(plan.url);
  return plan;
}
