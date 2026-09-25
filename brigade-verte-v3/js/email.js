// Envoi du rapport : préparation du message et ouverture de la messagerie.
// L'application PRÉPARE le message ; l'agent l'envoie lui-même (jamais d'envoi
// automatique). Aucune plateforme ne garantit l'ouverture d'une appli tierce :
// chaque tentative a donc un repli visible (Outlook Web, autre messagerie,
// copie du message).
//
// Mise en forme : un lien (mailto:, ms-outlook:, Outlook Web) ne transporte
// QUE du texte brut. Les secteurs y sont écrits en MAJUSCULES. La version
// mise en forme (secteurs en gras souligné) passe par le presse-papiers
// (HTML + texte), collée telle quelle par Outlook, Gmail, etc.

import { detectPlatform } from "./utils.js";

/* ─── Contenu ─── */

// Titre de secteur, seul sur sa ligne : « Secteur Centre : ».
const SECTOR_LINE = /^(\s*)(Secteur (?:Centre|Ouest|Nord|Est|Sud))(\s*:?\s*)$/i;

const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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
 *  · html  : secteurs en <b><u>…</u></b>, retours à la ligne conservés ;
 *  · plain : secteurs en MAJUSCULES (texte brut des liens) ;
 *  · previewHtml : aperçu dans l'application (même mise en forme que html).
 */
export function buildEmailBody(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const plain = lines.map((l) => l.replace(SECTOR_LINE, (_, a, t, b) => a + t.toUpperCase() + b)).join("\n");
  const htmlLines = lines.map((l) => {
    const m = l.match(SECTOR_LINE);
    const lead = (s) => escHtml(s).replace(/^ +/, (sp) => "&nbsp;".repeat(sp.length));
    return m ? `${lead(m[1])}<b><u>${escHtml(m[2])}</u></b>${escHtml(m[3])}` : lead(l);
  });
  const html =
    '<div style="font-family:Calibri,Aptos,Arial,sans-serif;font-size:11pt;line-height:1.4;color:#111">' + htmlLines.join("<br>\n") + "</div>";
  const previewHtml = lines
    .map((l) => {
      const m = l.match(SECTOR_LINE);
      return m ? `${escHtml(m[1])}<b class="mailSector"><u>${escHtml(m[2])}</u></b>${escHtml(m[3])}` : escHtml(l);
    })
    .join("\n");
  return { plain, html, previewHtml };
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
 * Android : lien « intent » vers l'appli Outlook ; si elle n'est pas
 * installée, le navigateur (Chrome, Edge, Samsung Internet) ouvre de lui-même
 * Outlook Web — repli géré par le système, sans minuterie.
 */
export function androidIntentUrl(msg) {
  const inner = query({ to: msg.to.join(","), subject: msg.subject, body: msg.body });
  return `intent://compose?${inner}#Intent;scheme=ms-outlook;package=com.microsoft.office.outlook;S.browser_fallback_url=${enc(outlookWebUrl(msg))};end`;
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
  else kind = platform === "ios" ? "app" : platform === "android" ? "intent" : "mailto";

  const build = { web: outlookWebUrl, mailto: mailtoUrl, app: outlookAppUrl, intent: androidIntentUrl }[kind];
  let url = build(msg);
  let truncated = false;
  // Messageries mobiles : liens longs acceptés ; Outlook classique sur PC : non.
  const limit = kind === "mailto" && platform !== "desktop" ? URL_LIMITS.app : URL_LIMITS[kind];
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
    setTimeout(() => {
      document.removeEventListener("visibilitychange", markLeft);
      window.removeEventListener("pagehide", onBlur);
      if (!left && document.visibilityState === "visible") onNotOpened(plan);
    }, waitMs);
  }
  go(plan.url);
  return plan;
}
