// Mode clavier (téléphone et tablette) : quand le clavier du téléphone est
// réellement ouvert, l'application lui laisse toute la place.
//   · html.kb-open + .app.is-typing : en-tête, barre basse, carte, en-tête des
//     étapes masqués ; barres collantes rendues statiques ou compactes
//     (css/layout.css, section « Mode clavier ») ;
//   · --vvh : hauteur réellement visible au-dessus du clavier (visualViewport),
//     pour que listes de suggestions et éditeur de texte tiennent à l'écran ;
//   · le champ est ramené en haut de l'écran, ses suggestions juste en dessous.
//
// Détection : un champ de texte a le focus ET la zone visible a nettement
// rétréci (clavier ouvert). Si le clavier se ferme alors que le champ garde le
// focus (touche retour d'Android, bouton « OK » d'iPhone), le mode est levé
// aussitôt : en-tête et navigation reviennent. Clavier physique, ordinateur
// (≥ 1024 px) : rien ne change.

import { MQ } from "./router.js";

const TEXT_ENTRY =
  'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=date]):not([type=button]):not([type=submit]):not([type=range]), textarea, [contenteditable="true"]';
const isTextEntry = (el) => !!(el && el.matches && el.matches(TEXT_ENTRY));

// Rétrécissement à partir duquel on considère le clavier ouvert / fermé (px).
const OPEN_DELTA = 120;
const CLOSE_DELTA = 60;

export function initKeyboard() {
  const desktop = window.matchMedia(MQ.desktop);
  const root = document.documentElement;
  const app = document.getElementById("app");
  const panel = document.getElementById("panel");
  const vv = window.visualViewport;
  const visibleHeight = () => (vv ? vv.height : window.innerHeight);

  // Hauteur de référence (clavier fermé), par largeur d'écran (rotation).
  let base = { w: window.innerWidth, h: visibleHeight() };
  let open = false;
  let closeTimer;
  let scrollTimer;

  const syncHeight = () => root.style.setProperty("--vvh", `${Math.round(visibleHeight())}px`);

  /** Ramène le champ en haut de la zone visible (suggestions dessous). */
  const reveal = () => {
    clearTimeout(scrollTimer);
    // Après la fin de l'animation d'ouverture du clavier.
    scrollTimer = setTimeout(() => {
      const el = document.activeElement;
      if (!open || !isTextEntry(el)) return;
      const target = el.closest(".combo, .field, .docTo, .doc") || el;
      target.scrollIntoView({ block: "start", behavior: "auto" });
    }, 120);
  };

  const setOpen = (on, { compensate = false } = {}) => {
    if (on === open) return;
    open = on;
    clearTimeout(closeTimer);
    if (on) {
      root.classList.add("kb-open");
      app?.classList.add("is-typing");
      reveal();
      return;
    }
    // Retour de la mise en page : la carte réapparaît au-dessus ; on décale la
    // page d'autant pour que le contenu affiché ne saute pas.
    const before = compensate && panel ? panel.getBoundingClientRect().top : 0;
    app?.classList.add("no-anim");
    root.classList.remove("kb-open");
    app?.classList.remove("is-typing");
    if (compensate && panel) {
      const delta = panel.getBoundingClientRect().top - before;
      if (delta > 0) window.scrollBy(0, delta);
    }
    requestAnimationFrame(() => app?.classList.remove("no-anim"));
  };

  const evaluate = () => {
    syncHeight();
    const h = visibleHeight();
    const w = window.innerWidth;
    const typing = !desktop.matches && isTextEntry(document.activeElement);
    // Rotation ou fenêtre redimensionnée sans clavier : nouvelle référence.
    if (w !== base.w) base = { w, h: typing ? Math.max(h, base.h) : h };
    if (!typing) {
      if (!open) base.h = h; // clavier fermé : la hauteur actuelle fait référence
      return;
    }
    if (!open && h < base.h - OPEN_DELTA) setOpen(true);
    // Clavier fermé, champ toujours actif (touche retour) : mode levé tout de suite.
    else if (open && h >= base.h - CLOSE_DELTA) setOpen(false, { compensate: true });
  };

  syncHeight();
  if (vv) {
    vv.addEventListener("resize", evaluate);
    window.addEventListener("resize", evaluate);
  }

  document.addEventListener("focusin", (e) => {
    if (desktop.matches || !isTextEntry(e.target)) return;
    clearTimeout(closeTimer);
    // Navigateur sans visualViewport : on se fie au focus.
    if (!vv) setOpen(true);
    else if (open) reveal(); // passage d'un champ à un autre, clavier déjà ouvert
    else evaluate();
  });

  // Fin de frappe : on attend la fin du geste en cours (sinon le bouton visé
  // glisse sous le doigt quand la mise en page revient).
  document.addEventListener("focusout", () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (isTextEntry(document.activeElement)) return;
      setOpen(false, { compensate: true });
    }, 350);
  });

  // Passage à l'ordinateur (fenêtre agrandie) : mode clavier levé.
  desktop.addEventListener?.("change", () => {
    if (desktop.matches) setOpen(false);
  });
}
